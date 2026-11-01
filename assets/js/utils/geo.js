/*
 * Géolocalisation : distance entre deux points et accès à la position de l'appareil.
 * La vérification qui compte (« êtes-vous dans l'enceinte ? ») est refaite par le serveur : la position envoyée par un
 * navigateur peut être falsifiée, ce code n'est qu'un confort d'usage (voir projet.md, « Présence géolocalisée »).
 */

const EARTH_RADIUS_M = 6_371_000;
const toRad = (deg) => (deg * Math.PI) / 180;
const METERS_PER_DEGREE = toRad(1) * EARTH_RADIUS_M; // un degré de latitude (≈ 111,2 km)

/** Distance en mètres entre deux points { lat, lng } (formule de haversine). */
export function distanceMeters(a, b) {
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

/** « 42 m » ou « 1,3 km ». */
export function formatDistance(meters) {
    return meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} km`;
}

/** Erreur de localisation avec un message affichable (code : denied | unavailable | timeout | unsupported | insecure). */
export class GeoError extends Error {
    constructor(code, message) {
        super(message);
        this.name = 'GeoError';
        this.code = code;
    }
}

const MESSAGES = {
    1: ['denied', 'Localisation refusée : autorisez-la dans votre navigateur pour marquer votre présence.'],
    2: ['unavailable', 'Position indisponible. Vérifiez que la localisation est activée sur votre appareil.'],
    3: ['timeout', "La localisation a pris trop de temps. Réessayez en extérieur ou près d'une fenêtre."],
};

/** Position actuelle de l'appareil : { lat, lng, accuracy } (accuracy en mètres) ou GeoError. */
export function locate({ timeout = 15000 } = {}) {
    return new Promise((resolve, reject) => {
        if (!window.isSecureContext) { reject(new GeoError('insecure', 'La géolocalisation exige une connexion sécurisée (HTTPS).')); return; }
        if (!navigator.geolocation) { reject(new GeoError('unsupported', 'Ce navigateur ne permet pas la géolocalisation.')); return; }
        navigator.geolocation.getCurrentPosition(
            ({ coords }) => resolve({ lat: coords.latitude, lng: coords.longitude, accuracy: coords.accuracy }),
            (error) => { const [code, message] = MESSAGES[error.code] ?? ['unavailable', MESSAGES[2][1]]; reject(new GeoError(code, message)); },
            { enableHighAccuracy: true, timeout, maximumAge: 0 },
        );
    });
}

/** Positions simulées autour de l'établissement, pour la démonstration (mode mock) : la vraie position n'y est pas utilisable. */
export const SIMULATIONS = {
    inside: { label: "Dans l'enceinte (à 40 m)", meters: 40, accuracy: 15 },
    near: { label: 'Juste en dehors (à 480 m)', meters: 480, accuracy: 15 },
    far: { label: 'Loin (à 1,3 km)', meters: 1300, accuracy: 20 },
    imprecise: { label: "Dans l'enceinte, mais signal imprécis (±250 m)", meters: 40, accuracy: 250 },
};

export function simulatedPosition(kind, center) {
    const preset = SIMULATIONS[kind];
    return { lat: center.lat + preset.meters / METERS_PER_DEGREE, lng: center.lng, accuracy: preset.accuracy };
}
