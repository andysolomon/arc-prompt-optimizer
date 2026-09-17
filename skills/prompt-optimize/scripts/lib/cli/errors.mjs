export class CliError extends Error {
    code;
    constructor(code, message) {
        super(message);
        this.name = "CliError";
        this.code = code;
    }
}
