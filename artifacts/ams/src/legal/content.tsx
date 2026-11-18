import type { ReactNode } from 'react';
import { DATA_CONTACT_EMAIL, LEGAL_ENTITY_NAME } from './entity';

export interface LegalSection {
  heading: string;
  body: ReactNode;
}

const mail = <a className="text-primary underline" href={`mailto:${DATA_CONTACT_EMAIL}`}>{DATA_CONTACT_EMAIL}</a>;

export const PRIVACY: { title: string; intro: ReactNode; sections: LegalSection[] } = {
  title: 'Privacy Notice',
  intro: (
    <>
      This notice explains how {LEGAL_ENTITY_NAME} ("we") handles personal data in the Insurance Agency
      Management System ("AMS"), in line with Kenya's Data Protection Act, 2019.
    </>
  ),
  sections: [
    {
      heading: 'Who is responsible',
      body: (
        <>
          Each insurance agency that uses the AMS decides what client and policy data it records and why, so the
          agency is the <strong>data controller</strong> for that data. We store and process it on the agency's
          behalf as its <strong>data processor</strong>. For the account details of agency staff (name, email,
          phone) and billing records, we are the controller.
        </>
      ),
    },
    {
      heading: 'What we store',
      body: (
        <ul className="list-disc pl-5 space-y-1">
          <li>Agency details: name, contact email, phone, address and subscription records.</li>
          <li>Staff accounts: name, email, phone, role, sign-in activity and when terms were accepted.</li>
          <li>Client data entered by the agency: names, contact details, ID or KRA numbers where recorded.</li>
          <li>Policy, premium, commission, receipt, payout and renewal records entered by the agency.</li>
          <li>Payment confirmations from Paystack (reference, amount, channel). We never see card numbers or M-Pesa PINs.</li>
        </ul>
      ),
    },
    {
      heading: 'Why we use it',
      body: (
        <>
          To provide the service the agency signed up for: keeping its records, calculating commissions and
          renewals, producing reports, sending account and billing emails, and keeping the service secure. We do not
          sell personal data or use client data for advertising.
        </>
      ),
    },
    {
      heading: 'Where it is kept',
      body: (
        <>
          Data is stored with Supabase in the European Union (Ireland, eu-west-1) and the app is served through
          Vercel. Payments are handled by Paystack and emails by our email provider. These providers act on our
          instructions and protect the data under their own security terms. Storing data outside Kenya is
          necessary to provide the service.
        </>
      ),
    },
    {
      heading: 'How long we keep it',
      body: (
        <>
          While the agency has an account. If an agency closes its account, we delete its data within 90 days of a
          written request, except billing records we must keep for tax purposes.
        </>
      ),
    },
    {
      heading: 'Your rights',
      body: (
        <>
          You may ask to access, correct or delete personal data about you, object to its use, or ask for a copy.
          Clients of an agency should first contact that agency, which controls their data. Anyone may write to us
          at {mail}. You may also complain to the Office of the Data Protection Commissioner.
        </>
      ),
    },
    {
      heading: 'Security',
      body: (
        <>
          Access is limited by role (Owner, Manager, Agent) and every agency's data is kept separate at the
          database level. Connections are encrypted. If a breach affects your data we will tell the affected agency
          and the Commissioner as the Act requires.
        </>
      ),
    },
  ],
};

export const TERMS: { title: string; intro: ReactNode; sections: LegalSection[] } = {
  title: 'Terms of Service',
  intro: (
    <>
      These terms are an agreement between {LEGAL_ENTITY_NAME} ("we") and the insurance agency that creates an AMS
      account, and its staff who use it.
    </>
  ),
  sections: [
    {
      heading: 'The service',
      body: (
        <>
          The AMS helps agencies record clients and policies, track commissions, receipts, payouts and renewals, and
          produce reports. Figures it shows depend on the data the agency enters; the agency remains responsible for
          its dealings with insurers, clients and regulators.
        </>
      ),
    },
    {
      heading: 'Accounts',
      body: (
        <>
          The person who creates the agency is its Owner and is responsible for who they invite and what role they
          give them. Keep passwords private and tell us of any unauthorised use.
        </>
      ),
    },
    {
      heading: 'Plans and payment',
      body: (
        <>
          The service is paid monthly in advance, for one or more months at a time, through Paystack (M-Pesa or
          card), at the price shown on the Billing page when you pay. There is no free trial. Payments are not
          refundable except where the law requires. We may change prices with at least 30 days' notice; a change
          applies from your next payment.
        </>
      ),
    },
    {
      heading: 'If payment lapses',
      body: (
        <>
          The service is available only while the agency's plan is paid. A new agency gets access once its first
          payment goes through. After a paid period ends there are 3 days of grace with full access; after that,
          access stops until an Owner pays again. While access is stopped, Owners can still download the agency's
          clients and policies. We do not delete data because payment lapsed.
        </>
      ),
    },
    {
      heading: 'Your data',
      body: (
        <>
          The agency owns the data it enters. We use it only to provide the service, as described in the Privacy
          Notice.
        </>
      ),
    },
    {
      heading: 'Acceptable use',
      body: (
        <>
          Don't use the AMS for anything unlawful, to store data you have no right to hold, or to probe, overload or
          get around its security.
        </>
      ),
    },
    {
      heading: 'Availability and liability',
      body: (
        <>
          We work to keep the service available and the data safe, but provide it "as is". To the extent the law
          allows, our total liability is limited to the fees the agency paid in the 3 months before the claim.
        </>
      ),
    },
    {
      heading: 'Ending the agreement',
      body: (
        <>
          The agency may stop paying at any time. Either side may end the agreement by notice; we may suspend an
          account that breaches these terms. On request we will export or delete the agency's data.
        </>
      ),
    },
    {
      heading: 'Law',
      body: <>These terms are governed by the laws of Kenya. Questions: {mail}.</>,
    },
  ],
};
