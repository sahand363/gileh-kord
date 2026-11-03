/// <reference types="svelte" />
/// <reference types="vite/client" />

declare module 'jalaali-js' {
  export interface JalaaliDateObject {
    jy: number;
    jm: number;
    jd: number;
  }

  export interface GregorianDateObject {
    gy: number;
    gm: number;
    gd: number;
  }

  export function toJalaali(gy: number, gm: number, gd: number): JalaaliDateObject;
  export function toJalaali(date: Date): JalaaliDateObject;
  export function toGregorian(jy: number, jm: number, jd: number): GregorianDateObject;
  export function isValidJalaaliDate(jy: number, jm: number, jd: number): boolean;
  export function isLeapJalaaliYear(jy: number): boolean;
  export function jalaaliMonthLength(jy: number, jm: number): number;
}
