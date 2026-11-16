-- Maintain currency foreign keys and existing transactions; only supported options are fixed.
INSERT INTO "PaymentCurrency" ("code", "name", "symbol", "decimalPlaces", "isActive")
VALUES ('EUR', 'Euro', U&'\20AC', 2, true),
       ('GBP', 'British Pound', U&'\00A3', 2, true),
       ('USD', 'US Dollar', '$', 2, true)
ON CONFLICT ("code") DO UPDATE
SET "name" = EXCLUDED."name", "symbol" = EXCLUDED."symbol",
    "decimalPlaces" = 2, "isActive" = true;
