-- Migration: add_leads_cnpj_receitaws
-- Cria tabela "Lead" com 47 campos (Places, CNPJ scrape, ReceitaWS enrichment)

CREATE TABLE "Lead" (
    "id" TEXT NOT NULL,
    "placeId" TEXT NOT NULL,
    "name" TEXT,
    "formattedAddress" TEXT,
    "website" TEXT,
    "phone" TEXT,
    "rating" DOUBLE PRECISION,
    "userRatingCount" INTEGER,
    "googleMapsUri" TEXT,
    "businessStatus" TEXT,
    "streetNumber" TEXT,
    "route" TEXT,
    "sublocality" TEXT,
    "locality" TEXT,
    "administrativeArea" TEXT,
    "postalCode" TEXT,
    "country" TEXT,
    "cnpj" TEXT,
    "cnpjFormatted" TEXT,
    "cnpjSource" TEXT,
    "cnpjConfidence" INTEGER,
    "cnpjFetchStatus" TEXT NOT NULL DEFAULT 'pending',
    "cnpjFetchedAt" TIMESTAMP(3),
    "razaoSocial" TEXT,
    "nomeFantasia" TEXT,
    "situacaoCadastral" TEXT,
    "dataSituacaoCadastral" TEXT,
    "motivoSituacaoCadastral" TEXT,
    "naturezaJuridica" TEXT,
    "dataAbertura" TEXT,
    "capitalSocial" DOUBLE PRECISION,
    "porte" TEXT,
    "tipoEmpresa" TEXT,
    "emailReceita" TEXT,
    "telefoneReceita" TEXT,
    "enderecoBairro" TEXT,
    "enderecoCep" TEXT,
    "enderecoMunicipio" TEXT,
    "enderecoUf" TEXT,
    "enderecoNumero" TEXT,
    "enderecoComplemento" TEXT,
    "enderecoLogradouro" TEXT,
    "enderecoTipoLogradouro" TEXT,
    "cnaePrincipalCodigo" TEXT,
    "cnaePrincipalTexto" TEXT,
    "cnafeSecundarioJson" JSONB,
    "receitawsJson" JSONB,
    "receitawsFetchedAt" TIMESTAMP(3),
    "receitawsStatus" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Lead_placeId_key" ON "Lead"("placeId");
CREATE INDEX "Lead_cnpj_idx" ON "Lead"("cnpj");
CREATE INDEX "Lead_cnpjFetchStatus_idx" ON "Lead"("cnpjFetchStatus");
CREATE INDEX "Lead_receitawsStatus_idx" ON "Lead"("receitawsStatus");
CREATE INDEX "Lead_locality_administrativeArea_idx" ON "Lead"("locality", "administrativeArea");
CREATE INDEX "Lead_createdAt_idx" ON "Lead"("createdAt" DESC);
