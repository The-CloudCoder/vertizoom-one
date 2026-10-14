-- Company identity, billing defaults, and payment instructions for each organization.
ALTER TABLE "Organization"
  ADD COLUMN "legalName" TEXT,
  ADD COLUMN "logoUrl" TEXT,
  ADD COLUMN "addressLine1" TEXT,
  ADD COLUMN "addressLine2" TEXT,
  ADD COLUMN "city" TEXT,
  ADD COLUMN "state" TEXT,
  ADD COLUMN "postalCode" TEXT,
  ADD COLUMN "country" TEXT,
  ADD COLUMN "phone" TEXT,
  ADD COLUMN "businessEmail" TEXT,
  ADD COLUMN "website" TEXT,
  ADD COLUMN "gstin" TEXT,
  ADD COLUMN "pan" TEXT,
  ADD COLUMN "invoicePrefix" TEXT NOT NULL DEFAULT 'INV',
  ADD COLUMN "nextInvoiceNumber" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'INR',
  ADD COLUMN "defaultTaxRateBps" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "paymentTerms" TEXT,
  ADD COLUMN "bankAccountName" TEXT,
  ADD COLUMN "bankName" TEXT,
  ADD COLUMN "bankAccountNumber" TEXT,
  ADD COLUMN "bankIfsc" TEXT,
  ADD COLUMN "upiId" TEXT;

ALTER TABLE "Organization"
  ADD CONSTRAINT "Organization_nextInvoiceNumber_check" CHECK ("nextInvoiceNumber" >= 1),
  ADD CONSTRAINT "Organization_defaultTaxRateBps_check" CHECK ("defaultTaxRateBps" >= 0 AND "defaultTaxRateBps" <= 10000);
