# Auto films run on the platform's own fal and Daytona keys

BYOK keys used to live only in the author's browser and ride each request as `x-fal-key`. An Auto Film runs for 20–40 minutes with no request and no browser, and revisions re-run stages later, so a key held in the browser cannot drive it. Auto uses StorySeam's own fal key (`FAL_KEY`) and Daytona key, stored as Worker secrets; the author never adds a key, and StorySeam pays for every Film.

## Considered Options

- Hand the author's key to one job and delete it when the job ends — rejected: every revision would need the author's browser again.
- Store each author's fal key server-side, encrypted — rejected: authors should not need a fal account to make a Film.

## Consequences

- The sign-in page copy ("Generation runs on a rendering account you connect yourself … API keys you paste are kept in this browser only") is no longer true for Auto and must change in the same release.
- Every Film is StorySeam's cost, so spending limits are a platform concern, not an author setting.
