/*
 * Erreur de validation métier, avec le détail par champ pour que les formulaires affichent chaque message
 * sous le bon champ. Le backend PHP devra renvoyer le même format (voir projet.md).
 */

export class ValidationError extends Error {
    /** @param {string} message message général  @param {Record<string, string>} fields messages par nom de champ */
    constructor(message, fields = {}) {
        super(message);
        this.name = 'ValidationError';
        this.fields = fields;
    }
}
