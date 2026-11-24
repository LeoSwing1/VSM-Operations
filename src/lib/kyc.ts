/** KYC document types shown to employees and HR (required ones mirror kyc_required_docs() in 0035). */
export const DOC_LABELS: Record<string, { label: string; hint: string; required?: boolean }> = {
  PHOTO: { label: "Passport-size photo", hint: "Clear face, plain background", required: true },
  AADHAAR: { label: "Aadhaar (masked)", hint: "Download the masked Aadhaar from UIDAI — only the last 4 digits visible", required: true },
  PAN: { label: "PAN card", hint: "Front side", required: true },
  ADDRESS_PROOF: { label: "Address proof", hint: "Voter ID, passport, utility bill or rent agreement", required: true },
  BANK_PROOF: { label: "Bank proof", hint: "Cancelled cheque or first page of passbook", required: true },
  EDUCATION: { label: "Highest qualification", hint: "Degree / marksheet", required: true },
  EXPERIENCE: { label: "Experience letter", hint: "If you worked before" },
  RELIEVING: { label: "Relieving letter", hint: "From your last employer" },
  OTHER: { label: "Other", hint: "Anything HR asked for" },
};
