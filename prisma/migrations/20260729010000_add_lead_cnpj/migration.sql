-- Adiciona coluna cnpj na tabela Lead
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "cnpj" TEXT;
