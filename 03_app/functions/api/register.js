import {authenticate} from "../auth.js";
export const onRequestPost = context => authenticate(context, true);
