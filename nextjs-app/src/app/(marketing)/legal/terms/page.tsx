export const metadata = { title: 'Terms of Service · ContractIQ' };

export default function TermsPage() {
  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-subsection px-4 py-20">
      <h1 className="text-h2 text-grey-900">Terms of Service</h1>

      <section className="flex flex-col gap-3">
        <h2 className="text-h5 text-grey-900">Not legal advice</h2>
        <p className="text-body text-grey-500">
          ContractIQ is an AI-assisted review tool, not legal advice. It does not create a
          solicitor–client or attorney–client relationship, and its output is not a substitute for
          review by a qualified lawyer. Always verify critical terms in the document itself and take
          professional advice before you rely on them.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-h5 text-grey-900">Permitted use of contracts you upload</h2>
        <p className="text-body text-grey-500">
          You may upload only contracts you are entitled to review. Uploading a third party&apos;s
          confidential contract without their permission is prohibited, and you are responsible for
          holding the rights and consents needed for every document you submit. We may suspend an
          account we reasonably believe is being used this way.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-h5 text-grey-900">What the service does and does not handle</h2>
        <p className="text-body text-grey-500">
          ContractIQ supports English-language, text-layer PDF NDAs and MSAs under US or UK law, up
          to 10 MB and 20 pages. It does not handle scanned PDFs, non-English contracts, or highly
          unusual and bespoke clauses outside standard NDA and MSA structures, and it may miss them.
          The AI cannot take any action on your contract — it only reads and answers.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-h5 text-grey-900">Your account</h2>
        <p className="text-body text-grey-500">
          You are responsible for the security of your credentials and for activity under your
          account. You may delete any individual contract, or your entire account and all associated
          data, at any time from your settings.
        </p>
      </section>
    </main>
  );
}
