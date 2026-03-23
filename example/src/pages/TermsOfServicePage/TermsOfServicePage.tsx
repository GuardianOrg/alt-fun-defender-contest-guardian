import { useEffect } from "react";

import { useLocation } from "react-router";

import styles from "./TermsOfServicePage.module.css";

const TermsOfServicePage = () => {
  const { hash } = useLocation();

  useEffect(() => {
    if (hash) {
      const el = document.querySelector(hash);
      el?.scrollIntoView({ behavior: "smooth" });
    }
  }, [hash]);

  return (
    <div className={styles.termsOfServicePage}>
      <h1>BOUNCE TECH — TERMS OF SERVICE</h1>

      <p>Last Updated: 31st July 2025</p>

      <p>
        PLEASE READ THESE TERMS OF SERVICE CAREFULLY BEFORE USING THE BOUNCE
        TECH PROTOCOL OR INTERFACE.
      </p>

      <p>
        THESE TERMS INCLUDE A MANDATORY INDIVIDUAL ARBITRATION PROVISION AND A
        WAIVER OF CLASS ACTIONS.
      </p>

      <p>
        THE BOUNCE TECH PROTOCOL AND INTERFACE ENABLE ACCESS TO EXPERIMENTAL,
        DECENTRALIZED, AND RISKY BLOCKCHAIN TECHNOLOGIES. BY USING OUR SERVICES,
        YOU ACCEPT ALL ASSOCIATED RISKS AND AGREE TO THESE TERMS OF SERVICE.
      </p>

      <h2>1. Acceptance of the Terms of Service</h2>
      <p>
        These Terms of Service ("Terms") form a binding agreement between you
        ("you" or the "User") and Bounce Foundation, a Cayman Foundation company
        organized in the Cayman Islands ("Company," "we," "our," or "us").
      </p>
      <p>
        By accessing or using https://bounce.tech/ and its associated
        decentralized application (collectively, the "DApp"), you acknowledge
        and agree to be bound by these Terms and our{" "}
        <a href="/privacy-policy" target="_blank">
          Privacy Policy
        </a>
        .
      </p>
      <p>You may not use the DApp or its services if you:</p>
      <ul>
        <li>Do not agree to these Terms;</li>
        <li>
          Are under 18 or below the legal age of majority in your jurisdiction;
        </li>
        <li>
          Are a resident or citizen of the United States, United Kingdom, or any
          Prohibited Jurisdiction (as defined below);
        </li>
        <li>
          Are otherwise prohibited from using the DApp under Applicable Laws.
        </li>
      </ul>

      <h2>2. The Protocol; The Interface; Blockchain Fees</h2>
      <p>
        The Bounce Tech Protocol ("Protocol") is a decentralized suite of tools
        that interfaces with third-party perpetual futures exchanges. It is
        non-custodial, autonomous, and beyond the Company's control once
        deployed.
      </p>
      <p>
        Users may interact with the Protocol through a web interface (the
        "Interface"), but they may also do so independently. You are solely
        responsible for understanding the Protocol and its associated risks,
        including permanent loss of crypto-assets.
      </p>
      <p>
        Although the Protocol and Interface have undergone audits, you use them
        at your own risk. The Company disclaims all liability for any losses
        arising from bugs, exploits, or errors.
      </p>
      <p>
        You may incur network fees ("Blockchain Fees") associated with your
        interactions with the Protocol. These are outside of the Company's
        control.
      </p>

      <h2 id="prohibited-uses">3. Prohibited Uses</h2>
      <p>You agree not to use the DApp or the Services:</p>
      <ul>
        <li>In violation of any Applicable Laws;</li>
        <li>To exploit, harm, or deceive others;</li>
        <li>To engage in spam, fraud, or phishing;</li>
        <li>
          If you are a resident of the United States, United Kingdom, Ontario
          (Canada), Russia (including Russian-occupied regions of Ukraine),
          Lebanon, Somalia, Zimbabwe, Belarus, Burma (Myanmar), China, Cuba,
          Democratic Republic of Congo, Iran, Iraq, Liberia, North Korea, Sudan,
          Syria, Venezuela, Yemen, or any other jurisdiction subject to
          sanctions or trade restrictions imposed by the United States, United
          Nations, European Union, or United Kingdom (including those maintained
          by OFAC);
        </li>
        <li>To impersonate others or misrepresent your identity;</li>
        <li>
          To harm the DApp, the Protocol, or any associated blockchain networks.
        </li>
      </ul>

      <h2>4. Monitoring & Termination</h2>
      <p>We reserve the right to:</p>
      <ul>
        <li>Take legal action for any misuse of the DApp;</li>
        <li>Block access to the DApp at our discretion;</li>
        <li>Cooperate with law enforcement as needed.</li>
      </ul>
      <p>
        Due to the immutable nature of blockchains, we cannot reverse or undo
        transactions made using the Protocol.
      </p>

      <h2>5. Changes to the Terms</h2>
      <p>
        We may revise these Terms at any time. Continued use of the DApp after
        any changes constitutes acceptance. Check this page regularly for
        updates.
      </p>

      <h2>6. Access & Security</h2>
      <p>
        You are responsible for maintaining the security of your Web3 wallet,
        private keys, and any API keys issued by the Company. Do not share these
        credentials with others.
      </p>
      <p>
        We may restrict or revoke your access to the DApp for violations of
        these Terms.
      </p>

      <h2>7. Intellectual Property</h2>
      <p>
        The DApp and all content (except open-source components) are owned by
        the Company and protected by law. You may only use the content as
        expressly permitted by these Terms.
      </p>

      <h2>8. Trademarks</h2>
      <p>
        You may use the term "Bounce Tech" in a non-deceptive, non-misleading
        manner. Use of the Company's trademarks or logos requires prior written
        consent.
      </p>

      <h2>9. No Offer of Securities</h2>
      <p>
        Nothing on the DApp constitutes an offer to sell or a solicitation of an
        offer to buy securities. Use of the Protocol is not a regulated
        financial activity.
      </p>

      <h2>10. No Professional Advice</h2>
      <p>
        All content is provided for informational purposes only and does not
        constitute legal, financial, tax, or investment advice.
      </p>

      <h2>11. No Fiduciary Duties</h2>
      <p>
        We do not owe you any fiduciary duties. Your use of the DApp does not
        create a partnership, agency, or fiduciary relationship.
      </p>

      <h2>12. No Insurance</h2>
      <p>
        Your use of the Protocol is not protected by FDIC, SIPC, or any other
        insurance.
      </p>

      <h2>13. Links to Third-Party Sites</h2>
      <p>
        We are not responsible for content or services on third-party websites
        linked through the DApp.
      </p>

      <h2>14. DAO Governance Disclaimer</h2>
      <p>
        The Protocol may be governed by a decentralized autonomous organization
        ("DAO"), which is independent of the Company. The Company does not
        control DAO decisions or the execution of DAO proposals.
      </p>
      <p>
        Participating in a DAO involves risks, including potential loss of funds
        due to bugs, governance decisions, or regulatory uncertainty.
      </p>

      <h2>15. Leveraged Tokens Warning</h2>
      <p>
        Leveraged tokens are inherently risky. You may lose all your funds. They
        are not suitable for all users.
      </p>

      <h2>16. Third-Party Provider Disclaimer</h2>
      <p>
        Some Services rely on third-party platforms or exchanges. We are not
        responsible for their conduct, terms, or performance.
      </p>

      <h2>17. Export Controls & Sanctions</h2>
      <p>
        You may not use the DApp if you are subject to U.S. or international
        sanctions or if your access would violate export control laws.
      </p>

      <h2>18. Warranty Disclaimer</h2>
      <p>
        THE DAPP, INTERFACE, AND PROTOCOL ARE PROVIDED "AS IS." THE COMPANY
        DISCLAIMS ALL WARRANTIES, EXPRESS OR IMPLIED, INCLUDING FITNESS FOR A
        PARTICULAR PURPOSE AND NON- INFRINGEMENT.
      </p>

      <h2>19. Limitation of Liability</h2>
      <p>
        TO THE FULLEST EXTENT PERMITTED BY LAW, THE COMPANY SHALL NOT BE LIABLE
        FOR ANY INDIRECT, SPECIAL, INCIDENTAL, OR CONSEQUENTIAL DAMAGES.
      </p>
      <p>
        IN NO EVENT SHALL OUR TOTAL LIABILITY TO YOU EXCEED $0 OR THE AMOUNT YOU
        PAID DIRECTLY TO THE COMPANY IN THE SIX MONTHS PRIOR TO THE CLAIM.
      </p>

      <h2>20. Assumption of Risk; Waiver</h2>
      <p>
        You understand that use of the DApp involves significant risks,
        including the complete loss of funds, and you assume full responsibility
        for those risks.
      </p>
      <p>
        If you are a California resident, you waive rights under Civil Code
        Section 1542.
      </p>

      <h2>21. Indemnification</h2>
      <p>
        You agree to indemnify and hold harmless the Company from all claims
        arising from your use of the DApp or violation of these Terms.
      </p>

      <h2>22. Governing Law</h2>
      <p>
        These Terms shall be governed by New York law, without regard to
        conflict of law rules.
      </p>

      <h2>23. Arbitration & Class Action Waiver</h2>
      <p>
        All disputes shall be resolved by binding arbitration under the AAA
        Rules. No class actions are permitted.
      </p>

      <h2>24. Claims Deadline</h2>
      <p>
        Any claim arising from these Terms must be filed within six (6) months
        or be forever barred.
      </p>

      <h2>25. Severability & Waiver</h2>
      <p>
        If any provision is invalid, the remainder remains in effect. Our
        failure to enforce a provision is not a waiver.
      </p>

      <h2>26. Entire Agreement</h2>
      <p>
        These Terms, including the{" "}
        <a href="/privacy-policy" target="_blank">
          Privacy Policy
        </a>
        , constitute the entire agreement between you and the Company regarding
        your use of the DApp.
      </p>

      <p>For questions or support, contact: contact@bounce.tech</p>

      <p>© {new Date().getFullYear()} Bounce Tech</p>
    </div>
  );
};

export default TermsOfServicePage;
