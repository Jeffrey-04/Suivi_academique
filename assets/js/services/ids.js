/* Génération d'identifiants du type « stu-055 » (préfixe + numéro séquentiel sur 3 chiffres ou plus). */

export function nextId(prefix, items) {
    const max = items.reduce((m, item) => Math.max(m, Number(item.id.split('-').pop()) || 0), 0);
    return `${prefix}-${String(max + 1).padStart(3, '0')}`;
}

/** Identifiants successifs : appeler next() pour chaque nouvel enregistrement d'un même lot. */
export function idSequence(prefix, items, width = 3) {
    let max = items.reduce((m, item) => Math.max(m, Number(item.id.split('-').pop()) || 0), 0);
    return () => `${prefix}-${String(++max).padStart(width, '0')}`;
}
