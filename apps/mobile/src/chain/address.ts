const HNY_ADDRESS_REGEX = /^HNY_[0-9a-f]{40}$/

export function isValidHnyAddress(address: string): boolean {
  return HNY_ADDRESS_REGEX.test(address)
}
}
