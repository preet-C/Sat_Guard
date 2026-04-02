/**
 * propagator.js — SGP4 satellite propagation using satellite.js
 *
 * All coordinate conversions use:
 *   • satellite.gstime()      for GMST (Greenwich Mean Sidereal Time)
 *   • satellite.eciToGeodetic() with WGS84 ellipsoid
 *
 * No spherical approximations. No shortcuts.
 */

import * as satellite from "satellite.js";

/**
 * Parse two TLE lines into a satrec object that SGP4 can propagate.
 * @param {string} tle1 - TLE line 1
 * @param {string} tle2 - TLE line 2
 * @returns {object} satrec object (or null if parsing fails)
 */
export function parseTLE(tle1, tle2) {
  try {
    const satrec = satellite.twoline2satrec(tle1.trim(), tle2.trim());
    // twoline2satrec doesn't throw on bad TLE — it sets satrec.error != 0
    if (satrec.error !== 0) {
      console.warn("TLE parse error code", satrec.error, "for:", tle1);
      return null;
    }
    return satrec;
  } catch {
    console.warn("Failed to parse TLE:", tle1);
    return null;
  }
}

/**
 * Propagate a satrec to a specific date and return geodetic coords.
 * Uses eciToGeodetic with WGS84 ellipsoid — never spherical approx.
 *
 * @param {object} satrec - satellite record from parseTLE
 * @param {Date}   date   - JavaScript Date object
 * @returns {{ lat: number, lon: number, alt: number } | null}
 *          lat/lon in degrees, alt in km. Null on propagation error.
 */
export function propagatePosition(satrec, date) {
  // SGP4 propagation → ECI position/velocity
  const positionAndVelocity = satellite.propagate(satrec, date);
  const positionEci = positionAndVelocity.position;

  // propagate() returns false on error
  if (!positionEci || positionEci === false) {
    return null;
  }

  // GMST via satellite.js gstime() — the only correct way
  const gmst = satellite.gstime(date);

  // ECI → Geodetic (WGS84 ellipsoid, not spherical)
  const geodetic = satellite.eciToGeodetic(positionEci, gmst);

  return {
    lat: satellite.degreesLat(geodetic.latitude),
    lon: satellite.degreesLong(geodetic.longitude),
    alt: geodetic.height, // km
  };
}

/**
 * Propagate a path of positions over time.
 *
 * @param {object} satrec          - satellite record from parseTLE
 * @param {Date}   startDate       - start time
 * @param {number} steps           - number of positions to compute
 * @param {number} intervalSeconds - seconds between each step
 * @returns {Array<{ lat: number, lon: number, alt: number, time: Date }>}
 */
export function propagatePath(satrec, startDate, steps, intervalSeconds) {
  const path = [];
  for (let i = 0; i < steps; i++) {
    const time = new Date(startDate.getTime() + i * intervalSeconds * 1000);
    const pos = propagatePosition(satrec, time);
    if (pos) {
      path.push({ ...pos, time });
    }
  }
  return path;
}
