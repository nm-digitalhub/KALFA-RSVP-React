// The contract has one document per pricing model (the agreement_documents.model column). Kept in its own dependency-free
// module so a validation schema can name the models without pulling in the whole contract template.
export const AGREEMENT_MODELS = ['per_result', 'package'] as const;
export type AgreementModel = (typeof AGREEMENT_MODELS)[number];
