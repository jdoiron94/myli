import { describe, expect, it } from 'vitest';
import { isPublicAddress } from './addresses.ts';

describe('isPublicAddress', () => {
  it('allows only addresses on the public internet', () => {
    const allowed = [
      '8.8.8.8',
      '1.1.1.1',
      '100.63.255.255', // just below carrier-grade NAT
      '172.32.0.1', // just past 172.16.0.0/12
      '2606:4700::6810:84e5',
      '2a00:1450:4001:82a::200e',
    ];
    const refused = [
      '0.0.0.0',
      '10.0.0.1',
      '100.64.0.1',
      '127.0.0.1',
      '127.255.255.254',
      '169.254.169.254', // the cloud metadata address
      '172.16.0.1',
      '172.31.255.255',
      '192.0.0.8',
      '192.168.1.10',
      '198.18.0.1',
      '224.0.0.1',
      '255.255.255.255',
      '::',
      '::1',
      '::ffff:127.0.0.1', // IPv4-mapped, written either way
      '::ffff:a00:1',
      '::ffff:8.8.8.8', // even a public IPv4 address isn't reached this way
      '64:ff9b::a00:1', // NAT64
      '2001::1', // Teredo
      '2001:db8::1',
      '2002:a00:1::', // 6to4, of 10.0.0.1
      'fc00::1',
      'fd12:3456::1',
      'fe80::1',
      'ff02::1',
      'localhost', // a name isn't an address
      '',
    ];
    const results = (addresses: string[]) =>
      Object.fromEntries(addresses.map((address) => [address, isPublicAddress(address)]));
    expect(results([...allowed, ...refused])).toEqual({
      ...Object.fromEntries(allowed.map((address) => [address, true])),
      ...Object.fromEntries(refused.map((address) => [address, false])),
    });
  });
});
