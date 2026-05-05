# Information Security and Incident Response Policy

*Synthetic document for demo purposes only. This policy is fictional and does not represent any real institution's information security or incident response program. Do not rely on it for legal or regulatory guidance.*

**Document ID:** POL-IS-001
**Owner:** Chief Information Security Officer (Office of Information Security)
**Version:** 1.0
**Effective Date:** 2026-01-15
**Review Cycle:** Annual, or upon material change to the Interagency Guidelines Establishing Information Security Standards (12 C.F.R. Part 30 Appendix B), Section 501(b) of the Gramm-Leach-Bliley Act (15 U.S.C. 6801), the Interagency Guidance on Response Programs for Unauthorized Access to Customer Information (70 Fed. Reg. 15736, March 29, 2005), the Computer-Security Incident Notification Rule (12 C.F.R. Part 53 / 12 C.F.R. 225.300-303 / 12 C.F.R. 304.20-23), the FFIEC Cybersecurity Assessment Tool, the FFIEC IT Examination Handbook, or applicable supervisory guidance

---

## 1. Purpose

This policy establishes how Meridian Trust Bank, N.A. ("the Bank") protects the confidentiality, integrity, and availability of customer information and Bank information assets, and how it detects, contains, eradicates, and reports computer-security incidents. It implements Section 501(b) of the Gramm-Leach-Bliley Act (15 U.S.C. 6801), the Interagency Guidelines Establishing Information Security Standards (12 C.F.R. Part 30 Appendix B, the "Security Guidelines"), the Interagency Guidance on Response Programs for Unauthorized Access to Customer Information (the "2005 Response Programs Guidance"), and the Computer-Security Incident Notification Rule codified at 12 C.F.R. Part 53 (OCC), 12 C.F.R. 225.300-303 (FRB), and 12 C.F.R. 304.20-23 (FDIC) (together, the "36-Hour Notification Rule").

The Bank's information security program is risk-based, written, approved by the Board of Directors, and reviewed at least annually. Information security incidents, control gaps, vulnerability exceptions, third-party security failures, and customer notice events feed the operational risk program, the third-party risk program (POL-VRM-001), the consumer complaint program (POL-COMP-001), the BSA/AML program (POL-BSA-001), and Board reporting.

Use of a third-party service provider does not diminish the Bank's responsibility to safeguard customer information; the same standards in this policy apply to information processed, stored, or transmitted by third parties on the Bank's behalf, as required by Section III.D of the Security Guidelines and POL-VRM-001.

## 2. Scope

This policy applies to all customer information, all Bank information assets, all systems that process, store, or transmit either, and to every employee, officer, director, contractor, intern, and authorized third party who accesses Bank information or systems. It covers information in any form (electronic, paper, or oral), at any stage of its life cycle (creation, transmission, storage, processing, archival, disposal), and on any platform (on-premises, cloud, mobile, third-party hosted).

This policy supersedes any prior information security or incident response policy. Where this policy conflicts with applicable law, regulation, or supervisory guidance, the law or guidance controls. Domain-specific policies (POL-VRM-001, POL-COMP-001, POL-BSA-001, the records retention policy, and the privacy / Regulation P notice policy) operate within this framework and inherit its definitions where consistent.

## 3. Definitions

**Customer Information** has the meaning given in Section I.C.2 of the Security Guidelines: any record containing nonpublic personal information about a customer, whether in paper, electronic, or other form, that is maintained by or on behalf of the Bank.

**Customer Information System** means any methods used to access, collect, store, use, transmit, protect, or dispose of customer information, including paper-based systems and systems operated by third parties on the Bank's behalf.

**Notification Incident** has the meaning given in 12 C.F.R. 53.2 / 225.301 / 304.21: a computer-security incident that has materially disrupted or degraded, or is reasonably likely to materially disrupt or degrade, the Bank's ability to (a) carry out banking operations, activities, or processes or deliver banking products and services to a material portion of its customer base in the ordinary course of business; (b) any business line of the Bank, including associated operations, services, functions, and support, that, upon failure, would result in a material loss of revenue, profit, or franchise value; or (c) operations of the Bank, including associated services, functions, and support, that, upon failure or discontinuance, would pose a threat to the financial stability of the United States.

**Computer-Security Incident** means an occurrence that results in actual harm to the confidentiality, integrity, or availability of an information system or the information that the system processes, stores, or transmits.

**Sensitive Customer Information** has the meaning given in the 2005 Response Programs Guidance: a customer's name, address, or telephone number in conjunction with the customer's Social Security number, driver's license number, account number, credit or debit card number, or a personal identification number or password that would permit access to the customer's account, plus any combination of components of customer information that would allow someone to log onto or access the customer's account.

**Information Asset** means any data set, application, system, infrastructure component, network, or facility that supports the Bank's operations and is owned, licensed, leased, or operated by or for the Bank.

**Privileged Access** means an account, role, or credential that exceeds the access of a standard user, including but not limited to administrator, root, domain admin, database admin, network admin, security admin, and emergency / break-glass accounts.

**Security Event** means an observable occurrence in a system or network. A Security Event becomes a Computer-Security Incident only upon a determination that an actual harm has occurred or is occurring.

**Vulnerability** means a weakness in an information asset, security procedure, internal control, or implementation that could be exploited by a threat source.

## 4. Governance and Roles

The Board of Directors approves this policy and the information security program at least annually, oversees the program's effectiveness, and receives at least annual reports on the program, material risks, control issues, third-party arrangements, test results, and notification incidents, consistent with Section III.F of the Security Guidelines.

The Chief Information Security Officer (CISO) owns the program, reports functionally to the Chief Risk Officer and administratively to the Chief Information Officer, and has independent authority to escalate to the Board's Risk Committee. The CISO is independent of the development, operations, and audit functions whose work the program tests.

The Chief Information Officer is accountable for implementing the controls in this policy across information assets the CIO operates. Business unit heads are accountable for the information assets they own, including data classification, access reviews, and remediation of findings within their environments.

The Information Security Steering Committee (ISSC), chaired by the CISO and including the CIO, Chief Risk Officer, Chief Compliance Officer, General Counsel, BSA Officer, Privacy Officer, Chief Operating Officer, and the Third-Party Risk Management Officer, meets at least quarterly to review the risk profile, the incident pipeline, exception requests, and the annual program assessment.

Internal Audit independently tests the program's design and operating effectiveness on a risk-based cycle, at least annually, consistent with Section III.F.3 of the Security Guidelines, and reports findings directly to the Audit Committee.

## 5. Risk Assessment, Asset Inventory, and Data Classification

The Bank maintains a current inventory of information assets and customer information, including the asset's owner, business purpose, location, supporting systems, classification, third-party dependencies, and recovery objectives. The inventory is reviewed at least annually and upon material change, and is the foundation for all downstream controls in this policy.

The Bank classifies information into Public, Internal, Confidential, and Restricted (the latter including Sensitive Customer Information, authentication secrets, encryption keys, BSA/AML investigative materials, and material non-public corporate information). Handling, storage, transmission, and disposal requirements are calibrated to classification.

The Bank conducts a written information security risk assessment at least annually and upon material change, identifying reasonably foreseeable internal and external threats, assessing likelihood and impact, evaluating the sufficiency of policies, procedures, customer information systems, and other arrangements to control the risks, and informing program adjustments. The risk assessment is approved by the CISO, reviewed by the ISSC, and reported to the Board, consistent with Section III.B of the Security Guidelines.

## 6. Access Management

Access to information assets follows the principles of least privilege, need-to-know, and segregation of duties. Provisioning is role-based, request-and-approval driven, and recorded. Multi-factor authentication is required for all remote access to internal systems, all access to customer-facing administrative interfaces, all privileged access, and all access to systems that process Restricted information.

Access reviews are performed at least quarterly for privileged access, semi-annually for access to systems that process Restricted information, and annually for all other production access. Reviews are performed by the asset or data owner; the CISO reviews completion. Terminations are processed within one business day of the effective separation date; involuntary terminations are processed before notice is delivered to the affected employee. Inactive accounts are disabled after 90 days of non-use and removed within an additional 90 days.

Privileged access uses dedicated accounts separate from a user's standard account, password vaulting with check-in/check-out, session recording for Tier 1 systems, and just-in-time elevation where supported. Shared, generic, or default credentials are prohibited except for documented service accounts whose use is logged, monitored, and reviewed.

## 7. Encryption, Key Management, and Secure Configuration

Restricted information at rest is encrypted using FIPS 140-validated cryptographic modules with industry-standard algorithms (AES-256 or stronger). Restricted information in transit, and any customer information traversing untrusted networks, is encrypted using TLS 1.2 or higher with current cipher suites. Use of deprecated protocols (SSL, early TLS, weak ciphers) is prohibited.

Encryption keys are generated, stored, rotated, and destroyed in a key management system separate from the data they protect. Key custody is documented; production key material is not held by a single individual. Keys are rotated on a defined schedule and upon known or suspected compromise, separation of a key custodian, or expiration of cryptographic strength.

Information assets are deployed against documented secure configuration baselines, derived from CIS Benchmarks or vendor-hardening guides where available, and reviewed at least annually. Drift from baseline is detected by automated tooling and remediated; documented exceptions follow Section 13.

## 8. Vulnerability and Patch Management

The Bank scans externally facing assets at least weekly and internally facing assets at least monthly, using authenticated scans where supported. Application-layer testing for Tier 1 customer-facing applications occurs at least annually and after material changes; independent penetration testing of the external perimeter, the customer-facing application stack, and the internal network occurs at least annually.

Remediation timelines, measured from discovery, are: Critical -- 7 calendar days; High -- 30 calendar days; Medium -- 90 calendar days; Low -- 180 calendar days. The CISO may accelerate these timelines for an actively exploited vulnerability or a vulnerability subject to a federal or industry directive (e.g., CISA Known Exploited Vulnerabilities Catalog, FFIEC alert).

Patches are tested and deployed under change management. Emergency patches may bypass the normal change cadence with CISO and CIO approval but are entered into the change record and reviewed at the next ISSC meeting.

## 9. Change Management and Software Development

Changes to production information assets are reviewed, tested, approved, and recorded under a change management process that segregates development, test, and production environments and separates the duties of developers from those who deploy to production.

Application development follows a secure development life cycle, including threat modeling for new customer-facing applications, secure coding training, peer code review, automated static and dependency-vulnerability analysis, and pre-release security testing. Customer information is not used in non-production environments unless masked, tokenized, or substituted with synthetic data.

## 10. Third-Party Information Security

Third parties that access, store, transmit, or process customer information, or that connect to a Bank system, are subject to the due-diligence, contracting, and ongoing-monitoring controls in POL-VRM-001, including SOC 2 Type II reviews, evidence of an incident response program, evidence of encryption and access management commensurate with this policy, breach-notification commitments aligned to the timing and content requirements in Section 12 of this policy, and the right to audit. The CISO is a required reviewer for any third-party engagement involving Restricted information or Tier 1 / critical activities, consistent with Section III.D of the Security Guidelines.

## 11. Logging, Monitoring, and Detection

Information assets generate security-relevant log events (authentication, privileged action, configuration change, access to Restricted information, security tooling alerts) that are forwarded to a centralized log management or SIEM platform. Logs are protected from unauthorized modification, retained per the records retention policy and not less than one year online plus the regulatory retention period in archive, and reviewed by the security operations function on a defined cadence.

The security operations function operates 24x7, monitors the SIEM, threat intelligence feeds, and customer-facing fraud telemetry, and is the entry point for incident triage. Detection use cases are mapped to the Bank's risk assessment, the FFIEC Cybersecurity Assessment Tool maturity statements, and the MITRE ATT&CK framework, and are reviewed at least annually.

## 12. Incident Response and Notification

The Bank maintains a written incident response plan that defines roles, severity criteria, communication channels (including out-of-band channels), preservation of evidence, containment and eradication procedures, recovery, and post-incident review. The CISO leads incident response. The General Counsel, Privacy Officer, Chief Risk Officer, BSA Officer, Communications, and the engaged business unit are members of the incident response team and are activated for incidents of severity 2 or higher.

The plan distinguishes a Security Event from a Computer-Security Incident, and a Computer-Security Incident from a Notification Incident under the 36-Hour Notification Rule and from an incident requiring customer notice under the 2005 Response Programs Guidance. The CISO, in consultation with the General Counsel, makes those determinations and documents them.

**Federal regulator notification (36-Hour Rule).** When the CISO determines that a Computer-Security Incident has risen to a Notification Incident, the Bank notifies its primary federal regulator (the OCC, FRB, or FDIC, as applicable) as soon as possible and no later than 36 hours after that determination, consistent with 12 C.F.R. 53.3 / 225.302 / 304.22. Notification may be made by any means the regulator has designated (telephone, email, or designated electronic channel) and is not required to include a detailed root-cause analysis at the time of initial notice. The 36-hour clock runs from the determination, not from initial detection or initial event.

**Customer notification (2005 Response Programs Guidance).** When the CISO and the Privacy Officer determine that misuse of Sensitive Customer Information has occurred or is reasonably possible, the Bank provides notice to affected customers as soon as possible. Notice is delayed only at the written request of an appropriate law enforcement agency. Notice describes the incident, the type of information involved, the steps the Bank has taken to protect the customer, a contact for questions, and recommendations for the customer (including review of account statements, fraud alerts, and the availability of identity-theft resources). The Bank also notifies its primary federal regulator of the incident and the planned customer notice in accordance with the Guidance.

**Service-provider notification.** Service providers must notify the Bank of any computer-security incident affecting Bank customer information, Bank systems, or services they provide to the Bank as soon as possible and no later than the timeframes set in their contracts (which the TPRMO and CISO require to be no longer than 24 hours from the service provider's determination), so the Bank can meet its 36-hour and customer-notice obligations.

Every Severity 1 or Severity 2 incident receives a post-incident review, including timeline, root cause, control failures, customer impact, and corrective actions, with results reported to the ISSC and (for Notification Incidents) to the Board's Risk Committee.

## 13. Exceptions

Exceptions to any control in this policy are documented, time-bound, risk-rated, compensating-control-supported, and approved by the CISO; exceptions involving Restricted information or Tier 1 systems also require CIO and Chief Risk Officer approval. Exceptions are reviewed at the ISSC, tracked to expiration, and reported in the annual program assessment.

## 14. Business Continuity and Disaster Recovery

The Bank maintains a business continuity plan and a disaster recovery plan covering the loss of facilities, technology, personnel, and key third parties. Recovery objectives (RTO and RPO) are set per business process based on the business impact analysis and aligned to the resilience expectations of the FFIEC IT Examination Handbook, Business Continuity Management booklet. Plans are tested at least annually, with results reported to the ISSC and the Board.

## 15. Recordkeeping

Information security program records, risk assessments, test results, exception decisions, training completion records, access reviews, vulnerability scan results, change-management records, and incident records are retained per the Bank's records retention policy, for not less than the period required by applicable law, regulation, or supervisory guidance, and in a manner that supports examination by the Bank's primary federal regulator.

## 16. Compliance Monitoring

Information Security Compliance, within the Office of Information Security and reporting to the CISO, performs continuous monitoring against this policy, including but not limited to: completion of access reviews; remediation of vulnerabilities within stated timelines; encryption coverage of Restricted data at rest and in transit; multi-factor authentication coverage of remote, privileged, and customer-administrative access; SIEM coverage and detection-use-case currency; incident response testing; third-party security review currency; and adherence to the 36-hour notification clock from determination of a Notification Incident. Findings are tracked to remediation in the GRC tool, reported to the ISSC, and (for material findings) to the Board's Risk Committee.

## 17. Training and Awareness

All employees and contractors complete information security awareness training at hire and at least annually thereafter, including phishing recognition, safe handling of Sensitive Customer Information, password and MFA hygiene, incident reporting, and acceptable use. Role-based training is required for developers (secure coding), system administrators (secure configuration and privileged access), the security operations function (incident handling), the privacy function, and the Board (annual cybersecurity briefing). Phishing simulations are run at least quarterly; repeat failers receive supplemental training and, where warranted, access restrictions.

## 18. Violations and Enforcement

Failure to comply with this policy may result in corrective action up to and including termination of employment or contract, recovery of losses, and referral to law enforcement or to the appropriate federal banking agency. The Bank does not retaliate against any individual for reporting in good faith a known or suspected information security incident, control failure, or policy violation. Allegations of retaliation are investigated by Internal Audit or Human Resources as appropriate and reported to the Audit Committee.
