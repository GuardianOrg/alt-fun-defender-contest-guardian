import styles from "./PrivacyPolicyPage.module.css";

const PrivacyPolicyPage = () => {
  return (
    <div className={styles.privacyPolicyPage}>
      <h1>BOUNCE TECH — PRIVACY POLICY</h1>

      <p>Last Updated: 31st July 2025</p>

      <p>
        Bounce Foundation, a Cayman Foundation company registered in the Cayman
        Islands ("Company," "we," "our," or "us"), respects your privacy. This
        Privacy Policy describes how we collect, use, and disclose personal and
        pseudonymous information when you interact with our website
        (https://bounce.tech/) and associated software applications (the
        "Website").
      </p>

      <p>
        By accessing or using the Website or services, you agree to this Privacy
        Policy.
      </p>

      <h2>1. Scope</h2>
      <p>This Privacy Policy applies to information collected:</p>
      <ul>
        <li>On or through the Website;</li>
        <li>Via email or other communications with us;</li>
        <li>Through Web3 wallet connections or API-based integrations;</li>
        <li>
          In association with your interaction with the Protocol via the
          Interface.
        </li>
      </ul>

      <h2>2. Eligibility</h2>
      <p>
        The Website and services are not intended for individuals under 18. We
        do not knowingly collect data from anyone under 18 years of age. If we
        learn that we have inadvertently done so, we will delete it.
      </p>

      <h2>3. Information We Collect</h2>
      <p>
        <strong>A. Information You Provide</strong>
      </p>
      <ul>
        <li>Wallet address or public blockchain identifiers</li>
        <li>
          Contact information (e.g., email address, if voluntarily provided)
        </li>
        <li>Content submitted through chat or support tools</li>
        <li>Any other data you choose to submit</li>
      </ul>

      <p>
        <strong>B. Information Collected Automatically</strong>
      </p>
      <ul>
        <li>IP address, device type, browser type, OS</li>
        <li>Usage data (e.g., page views, time on site, referral links)</li>
        <li>Cookie identifiers and analytics data</li>
      </ul>

      <p>
        We may use cookies and web beacons to analyze usage and improve service
        delivery.
      </p>

      <h2>4. How We Use Information</h2>
      <p>We use the information collected to:</p>
      <ul>
        <li>Operate and improve the Website and our services</li>
        <li>Communicate with you (when applicable)</li>
        <li>Detect and prevent fraud, abuse, or security threats</li>
        <li>Comply with legal obligations</li>
        <li>Enforce our Terms of Service</li>
      </ul>

      <h2>5. Disclosure of Information</h2>
      <p>We may share your information:</p>
      <ul>
        <li>
          With service providers who assist us (under contractual
          confidentiality)
        </li>
        <li>
          If required by law, regulation, legal process, or governmental request
        </li>
        <li>To protect rights, safety, or property (ours or others')</li>
        <li>As part of a business transfer, merger, or acquisition</li>
      </ul>

      <p>We do not sell personal information for monetary value.</p>

      <h2>6. Blockchain Transparency & Limitations</h2>
      <p>
        Due to the transparent and immutable nature of public blockchains,
        certain information (e.g., wallet addresses and on-chain activity) is
        public, permanent, and outside our control. This data may be correlated
        or combined with off-chain data by third parties. We cannot modify or
        erase blockchain data even upon request.
      </p>

      <h2>7. Your Rights</h2>
      <p>
        <strong>A. GDPR (EU Users)</strong>
      </p>
      <p>You may have rights to:</p>
      <ul>
        <li>Access or correct your personal data</li>
        <li>Request erasure (with limitations for blockchain data)</li>
        <li>Object to processing or request restrictions</li>
        <li>Data portability</li>
      </ul>

      <p>To exercise these rights, contact: contact@bounce.tech</p>

      <p>
        <strong>B. CCPA (California Residents)</strong>
      </p>
      <p>You may request:</p>
      <ul>
        <li>What personal data we've collected about you</li>
        <li>Deletion of your personal data</li>
        <li>That we do not sell your personal data</li>
      </ul>

      <p>We do not discriminate based on your exercise of these rights.</p>

      <h2>8. Data Retention</h2>
      <p>
        We retain data only as long as necessary to fulfill the purposes
        outlined in this policy, unless a longer period is required by law or
        security considerations.
      </p>

      <h2>9. Data Security</h2>
      <p>
        We implement reasonable technical and organizational safeguards.
        However, we cannot guarantee complete security due to the inherent risks
        of online transmission and blockchain transparency.
      </p>

      <h2>10. Third-Party Services & Links</h2>
      <p>
        Third-party services or links (e.g., Discord, GitHub, analytics
        providers) are governed by their own privacy policies. We do not control
        their data practices.
      </p>

      <h2>11. Changes to this Policy</h2>
      <p>
        We may update this Privacy Policy from time to time. Continued use of
        the Website after updates constitutes acceptance. Please check this page
        periodically.
      </p>

      <h2>12. Contact</h2>
      <p>
        For questions or to exercise your rights, contact: contact@bounce.tech
      </p>

      <p>© {new Date().getFullYear()} Bounce Tech</p>
    </div>
  );
};

export default PrivacyPolicyPage;
