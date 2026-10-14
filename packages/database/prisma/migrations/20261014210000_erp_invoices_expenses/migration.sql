-- ERP starter: organization-scoped invoices and expenses
CREATE TYPE "ErpInvoiceStatus" AS ENUM ('DRAFT', 'SENT', 'PAID', 'OVERDUE', 'CANCELLED');
CREATE TYPE "ErpExpenseStatus" AS ENUM ('PENDING', 'APPROVED', 'PAID');
CREATE TABLE "ErpInvoice" ("id" TEXT NOT NULL,"organizationId" TEXT NOT NULL,"invoiceNumber" TEXT NOT NULL,"customerName" TEXT NOT NULL,"issueDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"dueDate" TIMESTAMP(3),"amountCents" INTEGER NOT NULL,"status" "ErpInvoiceStatus" NOT NULL DEFAULT 'DRAFT',"notes" TEXT,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMP(3) NOT NULL,CONSTRAINT "ErpInvoice_pkey" PRIMARY KEY ("id"));
CREATE TABLE "ErpExpense" ("id" TEXT NOT NULL,"organizationId" TEXT NOT NULL,"title" TEXT NOT NULL,"vendor" TEXT,"category" TEXT NOT NULL,"incurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"amountCents" INTEGER NOT NULL,"status" "ErpExpenseStatus" NOT NULL DEFAULT 'PENDING',"notes" TEXT,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMP(3) NOT NULL,CONSTRAINT "ErpExpense_pkey" PRIMARY KEY ("id"));
CREATE UNIQUE INDEX "ErpInvoice_organizationId_invoiceNumber_key" ON "ErpInvoice"("organizationId","invoiceNumber");
CREATE INDEX "ErpInvoice_organizationId_status_updatedAt_idx" ON "ErpInvoice"("organizationId","status","updatedAt");
CREATE INDEX "ErpInvoice_organizationId_dueDate_idx" ON "ErpInvoice"("organizationId","dueDate");
CREATE INDEX "ErpExpense_organizationId_status_incurredAt_idx" ON "ErpExpense"("organizationId","status","incurredAt");
CREATE INDEX "ErpExpense_organizationId_category_idx" ON "ErpExpense"("organizationId","category");
ALTER TABLE "ErpInvoice" ADD CONSTRAINT "ErpInvoice_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ErpExpense" ADD CONSTRAINT "ErpExpense_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
