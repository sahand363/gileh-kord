import { describe, it, expect } from 'vitest';
import { generateUUID, generateId } from '../uuid';

const UUID_V4_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('UUID & ID Generation under HTTP and HTTPS conditions', () => {
  it('Tier 1: generates valid v4 UUIDs when crypto.randomUUID is available', () => {
    const id = generateUUID();
    expect(id).toMatch(UUID_V4_REGEX);
  });

  it('Tier 2 (HTTP IP simulation): generates valid v4 UUIDs when crypto.randomUUID is undefined', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) {
      const id = generateUUID({ disableRandomUUID: true });
      expect(id).toMatch(UUID_V4_REGEX);
      seen.add(id);
    }
    expect(seen.size).toBe(500);
  });

  it('Tier 3 (No Web Crypto API simulation): generates collision-free v4-compatible UUIDs when both APIs are unavailable', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      const id = generateUUID({
        disableRandomUUID: true,
        disableGetRandomValues: true
      });
      expect(id).toMatch(UUID_V4_REGEX);
      seen.add(id);
    }
    expect(seen.size).toBe(1000);
  });

  it('generates prefixed entity IDs without relying on crypto.randomUUID', () => {
    const purchId = generateId('purch', {
      disableRandomUUID: true,
      disableGetRandomValues: true
    });
    expect(purchId.startsWith('purch_')).toBe(true);
    expect(purchId.slice(6)).toMatch(UUID_V4_REGEX);
  });
});
