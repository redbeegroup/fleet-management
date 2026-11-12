-- Vehicle classes matching Myanmar licence categories (ဌ tractor, ဟ three-wheeler, ဂ machinery).
ALTER TYPE "VehicleClass" ADD VALUE IF NOT EXISTS 'THREE_WHEELER' BEFORE 'OTHER';
ALTER TYPE "VehicleClass" ADD VALUE IF NOT EXISTS 'TRACTOR' BEFORE 'OTHER';
ALTER TYPE "VehicleClass" ADD VALUE IF NOT EXISTS 'MACHINERY' BEFORE 'OTHER';

-- Normalise existing licence classes to the Latin codes used by dispatch rules.
UPDATE driver_licenses SET license_class = upper(trim(license_class)) WHERE license_class <> upper(trim(license_class));
