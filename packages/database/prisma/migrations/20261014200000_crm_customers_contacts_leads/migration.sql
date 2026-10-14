-- CRM customers, contacts, and sales pipeline
CREATE TYPE "CrmCustomerStatus" AS ENUM ('PROSPECT', 'ACTIVE', 'INACTIVE');
CREATE TYPE "CrmLeadStage" AS ENUM ('NEW', 'QUALIFIED', 'PROPOSAL', 'NEGOTIATION', 'WON', 'LOST');
CREATE TABLE "CrmCustomer" ("id" TEXT NOT NULL,"organizationId" TEXT NOT NULL,"name" TEXT NOT NULL,"industry" TEXT,"website" TEXT,"email" TEXT,"phone" TEXT,"status" "CrmCustomerStatus" NOT NULL DEFAULT 'PROSPECT',"notes" TEXT,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMP(3) NOT NULL,CONSTRAINT "CrmCustomer_pkey" PRIMARY KEY ("id"));
CREATE TABLE "CrmContact" ("id" TEXT NOT NULL,"organizationId" TEXT NOT NULL,"customerId" TEXT NOT NULL,"firstName" TEXT NOT NULL,"lastName" TEXT NOT NULL,"email" TEXT,"phone" TEXT,"jobTitle" TEXT,"notes" TEXT,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMP(3) NOT NULL,CONSTRAINT "CrmContact_pkey" PRIMARY KEY ("id"));
CREATE TABLE "CrmLead" ("id" TEXT NOT NULL,"organizationId" TEXT NOT NULL,"customerId" TEXT,"contactId" TEXT,"title" TEXT NOT NULL,"estimatedValueCents" INTEGER NOT NULL DEFAULT 0,"stage" "CrmLeadStage" NOT NULL DEFAULT 'NEW',"source" TEXT,"expectedCloseDate" TIMESTAMP(3),"notes" TEXT,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMP(3) NOT NULL,CONSTRAINT "CrmLead_pkey" PRIMARY KEY ("id"));
CREATE INDEX "CrmCustomer_organizationId_status_updatedAt_idx" ON "CrmCustomer"("organizationId","status","updatedAt");
CREATE INDEX "CrmCustomer_organizationId_name_idx" ON "CrmCustomer"("organizationId","name");
CREATE INDEX "CrmContact_organizationId_customerId_idx" ON "CrmContact"("organizationId","customerId");
CREATE INDEX "CrmContact_organizationId_lastName_firstName_idx" ON "CrmContact"("organizationId","lastName","firstName");
CREATE INDEX "CrmLead_organizationId_stage_updatedAt_idx" ON "CrmLead"("organizationId","stage","updatedAt");
CREATE INDEX "CrmLead_organizationId_customerId_idx" ON "CrmLead"("organizationId","customerId");
ALTER TABLE "CrmCustomer" ADD CONSTRAINT "CrmCustomer_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CrmContact" ADD CONSTRAINT "CrmContact_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CrmContact" ADD CONSTRAINT "CrmContact_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "CrmCustomer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CrmLead" ADD CONSTRAINT "CrmLead_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CrmLead" ADD CONSTRAINT "CrmLead_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "CrmCustomer"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CrmLead" ADD CONSTRAINT "CrmLead_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "CrmContact"("id") ON DELETE SET NULL ON UPDATE CASCADE;
