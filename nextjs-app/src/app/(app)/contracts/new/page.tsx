import { UploadWizard } from '@/components/upload/UploadWizard';

export const metadata = { title: 'Review a contract · ContractIQ' };

export default function NewContractPage() {
  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-component px-4 py-12">
      <div className="flex flex-col gap-2">
        <h1 className="text-h2 text-grey-900">Review a contract</h1>
        <p className="text-body text-grey-500">
          Choose the contract type, then upload the PDF. We extract the text once and keep it as the
          basis for everything that follows.
        </p>
      </div>
      <UploadWizard />
    </main>
  );
}
