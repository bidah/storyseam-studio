import { defineSandbox } from "eve/sandbox";
import { justbash } from "eve/sandbox/just-bash";

// Local dev: use the dependency-free pure-JS `just-bash` sandbox so the server
// starts instantly with no Docker image pull. Our tools reach the Shot Studio
// API over HTTP (not the sandbox), so this is sufficient for the chat + pipeline
// flows. Switch to docker() / vercel() when a skill needs real binaries (ffmpeg)
// inside the sandbox.
export default defineSandbox({
  backend: justbash(),
});
