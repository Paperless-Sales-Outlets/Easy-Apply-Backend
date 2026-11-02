// Staff employee numbers are exactly 6 digits (e.g. 099885). Leading zeros are
// part of the number, so it is always stored and compared as a string.
export const EMPLOYEE_NUMBER_PATTERN = /^\d{6}$/;
export const EMPLOYEE_NUMBER_MESSAGE = 'Employee number must be exactly 6 digits (e.g. 099885)';

/** Trims an employee number to a string ('' for null/undefined). */
export const cleanEmployeeNumber = (value) => (value === undefined || value === null ? '' : String(value).trim());

/** True when the value is a valid 6-digit employee number. */
export const isValidEmployeeNumber = (value) => EMPLOYEE_NUMBER_PATTERN.test(cleanEmployeeNumber(value));

/** Escapes text so it can be used literally inside a RegExp. */
export const escapeRegex = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
