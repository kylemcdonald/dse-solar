/** Round-trip copper resistance; length is one-way, conductor area is mm². */
export function copperVoltageDrop(oneWayMetres: number, currentAmps: number, areaMm2: number, temperatureC = 75) {
  if (oneWayMetres < 0 || currentAmps < 0 || areaMm2 <= 0 ||
    ![oneWayMetres, currentAmps, areaMm2, temperatureC].every(Number.isFinite)) {
    throw new RangeError("Wire length/current must be nonnegative and conductor area positive.");
  }
  return .0175 * (1 + .00393 * (temperatureC - 20)) * 2 * oneWayMetres * currentAmps / areaMm2;
}

/** Battery branch and controller pair may use different conductor areas. */
export function batteryPathVoltageDrop(batteryOneWayM: number, controllerOneWayM: number, currentA: number, batteryAreaMm2: number, controllerAreaMm2: number, temperatureC = 75) {
  return copperVoltageDrop(batteryOneWayM, currentA, batteryAreaMm2, temperatureC)
    + copperVoltageDrop(controllerOneWayM, currentA, controllerAreaMm2, temperatureC);
}
