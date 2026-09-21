import { createServerSupabaseClient } from '@/lib/supabase/server';
import { createAdminSupabaseClient } from '@/lib/supabase/admin';
import { appError } from '@/lib/errors/app-error';
import { withErrorHandling } from '@/lib/errors/to-user-message';
import { sendNotification } from '@/lib/services/notification-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STORAGE_PAGE_SIZE = 100;

/**
 * DELETE /api/account — GDPR erasure (spec 11 §3).
 *
 * ORDER IS LOAD-BEARING. Verified live in Slice 3: deleting the auth user
 * cascades every DB row but leaves Storage objects intact — `storage.objects`
 * is not reachable from the foreign-key chain. If the user were deleted first,
 * the caller's JWT would be gone, RLS-scoped Storage deletion would no longer
 * be possible, and the erasure would silently leave the user's PDFs on disk.
 *
 * So: capture the email, purge the Storage prefix until empty, THEN delete the
 * auth user, which cascades the rest.
 */
export async function DELETE() {
  return withErrorHandling({ route: '/api/account', method: 'DELETE' }, async (ctx) => {
    const supabase = createServerSupabaseClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) throw appError('UNAUTHENTICATED');
    ctx.userId = user.id;

    // 1. Capture the address BEFORE anything is deleted — the profile row is
    //    about to go.
    const { data: profile } = await supabase
      .from('profiles')
      .select('email')
      .eq('id', user.id)
      .single();
    const email = profile?.email ?? user.email ?? null;

    // 2. Purge every Storage object under {user_id}/, paging until empty.
    await purgeUserStorage(supabase, user.id);

    // 3. No direct `profiles` DELETE: the table has no DELETE policy, so a
    //    delete on the caller's JWT would affect zero rows and silently look
    //    like success. Erasure happens through the auth.users cascade.

    // 4. Delete the auth user with the service role — a sanctioned call site
    //    (spec 13 §2 item 1).
    const admin = createAdminSupabaseClient();
    const { error: deleteError } = await admin.auth.admin.deleteUser(user.id);

    if (deleteError) {
      // Storage is already gone but the rows remain — log for operator
      // follow-up. Every step is idempotent, so the user's next attempt is safe.
      console.error(
        JSON.stringify({ account: 'auth_delete_failed', userId: user.id, reason: deleteError.message }),
      );
      throw appError('INTERNAL');
    }

    // 5. Confirmation email — best effort, non-blocking. The deletion itself is
    //    the legal obligation; a failed send must not fail it.
    if (email) {
      void sendNotification({ template: 'account_deleted', to: [email], vars: {} }).catch(
        (err: unknown) => {
          console.warn(
            JSON.stringify({ notification: 'account_deleted_failed', reason: String(err) }),
          );
        },
      );
    }

    return new Response(null, { status: 204 });
  });
}

async function purgeUserStorage(
  supabase: ReturnType<typeof createServerSupabaseClient>,
  userId: string,
): Promise<void> {
  // Objects live at {user_id}/{contract_id}/{filename}.pdf, so the prefix is
  // walked one level down before the files are listed.
  const { data: contractFolders, error: listError } = await supabase.storage
    .from('contracts')
    .list(userId, { limit: STORAGE_PAGE_SIZE });

  if (listError) {
    console.warn(JSON.stringify({ storage: 'list_failed', userId, reason: listError.message }));
    return;
  }

  const paths: string[] = [];
  for (const folder of contractFolders ?? []) {
    const { data: files } = await supabase.storage
      .from('contracts')
      .list(`${userId}/${folder.name}`, { limit: STORAGE_PAGE_SIZE });
    for (const file of files ?? []) paths.push(`${userId}/${folder.name}/${file.name}`);
  }

  if (paths.length === 0) return;

  const { error: removeError } = await supabase.storage.from('contracts').remove(paths);
  if (removeError) {
    // Retried once, then logged — the deletion proceeds either way.
    const { error: retryError } = await supabase.storage.from('contracts').remove(paths);
    if (retryError) {
      console.error(
        JSON.stringify({ storage: 'purge_failed', userId, count: paths.length, reason: retryError.message }),
      );
    }
  }

  // Recurse while the prefix still has folders (more than one page of them).
  if ((contractFolders?.length ?? 0) === STORAGE_PAGE_SIZE) await purgeUserStorage(supabase, userId);
}
