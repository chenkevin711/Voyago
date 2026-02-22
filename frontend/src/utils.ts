import axios from "axios";

// https://medium.com/with-orus/the-5-commandments-of-clean-error-handling-in-typescript-93a9cbdf1af5
// if non-error object thrown, wrap it in an error object
function ensureError(value: unknown): Error {
    if (value instanceof Error) return value;

    let stringified;
    try {
        stringified = JSON.stringify(value);
    } catch {
        stringified = "[Unable to stringify the thrown value]";
    }

    const error = new Error(
        `Thrown value was originally not an error; stringified value is: ${stringified}`,
    );
    return error;
}

// https://axios-http.com/docs/handling_errors
// https://github.com/axios/axios/issues/3612
function getAxiosErrorMessages(err: unknown): string[] {
    const error = ensureError(err);
    console.log(error);
    if (!axios.isAxiosError(error)) {
        return [error.toString()];
    }
    if (!error.response) {
        return ["Server never sent response"];
    }
    // assumes response body will be { errors: <string>[] } if error
    // but in case it isn't, use axios error message instead
    if (!error.response.data?.errors) {
        return [error.message];
    }
    return error.response.data.errors;
}

export { getAxiosErrorMessages };