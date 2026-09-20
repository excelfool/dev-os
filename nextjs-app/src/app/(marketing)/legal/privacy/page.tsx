export const metadata = { title: 'Privacy & Data Protection · ContractIQ' };

export default function PrivacyPage() {
  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-subsection px-4 py-20">
      <h1 className="text-h2 text-grey-900">Privacy &amp; Data Protection</h1>

      <section className="flex flex-col gap-3">
        <h2 className="text-h5 text-grey-900">How your contracts are stored</h2>
        <p className="text-body text-grey-500">
          Contracts are encrypted at rest with AES-256 and transferred over TLS 1.3. Uploaded PDFs
          are held in private storage that only your account can read, through short-lived signed
          links that expire after one hour.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-h5 text-grey-900">How long we keep it</h2>
        <p className="text-body text-grey-500">
          The original PDF is retained for 90 days after you last open the contract, then deleted
          automatically. Opening a contract restarts that 90-day window. The extracted text, key
          terms and chat history are kept as your review record until you delete them, so a review
          you completed stays readable after the PDF is gone.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-h5 text-grey-900">Model training</h2>
        <p className="text-body text-grey-500">
          No contract content is used to train any model, by ContractIQ or by OpenAI. Training
          opt-in is disabled on our OpenAI account. We send an opaque user identifier with each
          request for abuse tracing — never your name, email or contract content.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-h5 text-grey-900">Deletion and your rights</h2>
        <p className="text-body text-grey-500">
          You may delete any single contract or your entire account and all associated data at any
          time from your settings. Account deletion removes every contract, PDF, extracted text, key
          term, chat message and feedback entry, and is completed immediately rather than by a
          manual request.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-h5 text-grey-900">Processors</h2>
        <p className="text-body text-grey-500">
          We use Supabase for database, authentication and storage, and OpenAI for inference.
          Article 28 data processing agreements with both are in place before any EU user is
          onboarded.
        </p>
      </section>
    </main>
  );
}
