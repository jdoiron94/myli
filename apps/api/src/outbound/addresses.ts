import { BlockList, isIPv4, isIPv6 } from 'node:net';

/**
 * Special-purpose IPv4 ranges (RFC 6890 and its registry): none of them is a public site. Kept apart
 * from the IPv6 list, because `BlockList` matches an IPv4 address against IPv6 ranges as the
 * IPv4-mapped address it would be, and `::/8` below would then refuse every one.
 */
const IPV4_REFUSED: [string, number][] = [
  ['0.0.0.0', 8], // "this network"
  ['10.0.0.0', 8], // private
  ['100.64.0.0', 10], // shared address space (carrier-grade NAT)
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local, the cloud metadata address included
  ['172.16.0.0', 12], // private
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.0.2.0', 24], // documentation
  ['192.88.99.0', 24], // 6to4 relays
  ['192.168.0.0', 16], // private
  ['198.18.0.0', 15], // benchmarking
  ['198.51.100.0', 24], // documentation
  ['203.0.113.0', 24], // documentation
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved, and the broadcast address
];

/** Special-purpose IPv6 ranges, including every way of writing or tunnelling an IPv4 address. */
const IPV6_REFUSED: [string, number][] = [
  ['::', 8], // unspecified, loopback, and IPv4-mapped and -compatible addresses
  ['64:ff9b::', 96], // NAT64
  ['64:ff9b:1::', 48], // local NAT64
  ['100::', 64], // discard
  ['2001::', 23], // IETF protocol assignments, Teredo included
  ['2001:db8::', 32], // documentation
  ['2002::', 16], // 6to4
  ['3fff::', 20], // documentation
  ['5f00::', 16], // segment routing
  ['fc00::', 7], // unique local
  ['fe80::', 10], // link-local
  ['fec0::', 10], // site-local, deprecated
  ['ff00::', 8], // multicast
];

function blockList(ranges: [string, number][], type: 'ipv4' | 'ipv6') {
  const list = new BlockList();
  for (const [network, prefix] of ranges) list.addSubnet(network, prefix, type);
  return list;
}

const ipv4Refused = blockList(IPV4_REFUSED, 'ipv4');
const ipv6Refused = blockList(IPV6_REFUSED, 'ipv6');

/**
 * Whether `address` is an IP address on the public internet, which outbound requests may go to
 * (ADR 0017). Anything else, a name included, isn't.
 */
export function isPublicAddress(address: string): boolean {
  if (isIPv4(address)) return !ipv4Refused.check(address, 'ipv4');
  if (isIPv6(address)) return !ipv6Refused.check(address, 'ipv6');
  return false;
}
