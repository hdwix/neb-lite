import { BadRequestException } from '@nestjs/common';
import * as libPhoneNumber from 'libphonenumber-js';
import { IsPhoneNumberFormatted } from './isPhoneNumber.validator';

describe('IsPhoneNumberFormatted', () => {
  let validator: IsPhoneNumberFormatted;

  beforeEach(() => {
    validator = new IsPhoneNumberFormatted();
  });

  it('throws when phone number is missing', () => {
    expect(() => validator.normalizePhoneNumberToE164('', 'ID')).toThrow(
      BadRequestException,
    );
  });

  it('returns true for valid telkomsel number', () => {
    expect(validator.normalizePhoneNumberToE164('+6281112345678', 'ID')).toBe(
      true,
    );
  });

  it('uses ID as the default region when none is provided', () => {
    expect(validator.normalizePhoneNumberToE164('+6281112345678')).toBe(true);
  });

  it('returns false when format is not E164', () => {
    expect(validator.normalizePhoneNumberToE164('081112345678', 'ID')).toBe(
      false,
    );
  });

  it('returns false when prefix is not allowed', () => {
    expect(validator.normalizePhoneNumberToE164('+6289912345678', 'ID')).toBe(
      false,
    );
  });

  it('returns false when number cannot be parsed', () => {
    expect(validator.normalizePhoneNumberToE164('123', 'ID')).toBe(false);
  });

  it('validate method delegates to normalize', () => {
    expect(validator.validate('+6281112345678', {} as any)).toBe(true);
  });

  it('returns false when parsed number is invalid', () => {
    const spy = jest
      .spyOn(libPhoneNumber, 'parsePhoneNumberFromString')
      .mockReturnValue({ isValid: () => false } as any);

    expect(validator.normalizePhoneNumberToE164('+6281112345678', 'ID')).toBe(
      false,
    );
    spy.mockRestore();
  });

  it('provides default error message', () => {
    expect(validator.defaultMessage({} as any)).toContain('phone number');
  });
});
