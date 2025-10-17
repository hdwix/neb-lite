import {
  ValidatorConstraint,
  ValidatorConstraintInterface,
  ValidationArguments,
} from 'class-validator';
import { CountryCode, parsePhoneNumberFromString } from 'libphonenumber-js';
import { BadRequestException } from '@nestjs/common';
import { ALLOWED_TELKOMSEL_PREFIXES } from '../constants/phone-prefix.constant';

@ValidatorConstraint({ name: 'IsPhoneNumberFormatted', async: false })
export class IsPhoneNumberFormatted implements ValidatorConstraintInterface {
  validate(phone: string, args: ValidationArguments) {
    return this.normalizePhoneNumberToE164(phone, 'ID');
  }

  defaultMessage(args: ValidationArguments) {
    return 'phone number ($value) must be in E164 format';
  }

  normalizePhoneNumberToE164(
    input: string,
    defaultRegion: CountryCode = 'ID',
  ): boolean {
    if (!input) throw new BadRequestException('Phone is required');
    const raw = input.trim();
    const allowedPrefixes = ALLOWED_TELKOMSEL_PREFIXES;

    // Try parse with default region first, then global
    const parsed = parsePhoneNumberFromString(raw, defaultRegion);

    if (!parsed || !parsed.isValid()) {
      return false;
    }

    const e164 = parsed.number; // e.g. +62812xxxxxxx

    // Telkomsel prefix check
    const isAllowed = allowedPrefixes.some((p) => e164.startsWith(p));
    if (!isAllowed) {
      return false;
    }

    if (raw !== e164) {
      return false;
    }

    return true;
  }
}
