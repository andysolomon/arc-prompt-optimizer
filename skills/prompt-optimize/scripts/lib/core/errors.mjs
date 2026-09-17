export class CoreValidationError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.name = "CoreValidationError";
        this.code = code;
    }
}
