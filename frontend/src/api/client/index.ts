import { authClient } from "./auth";
import { calibrationClient } from "./calibration";
import { jobsClient } from "./jobs";
import { printerClient } from "./printer";
import { paperClient } from "./paper";
import { paintClient } from "./paint";
import { sourcesClient } from "./sources";
import { galleryClient } from "./gallery";
import { fontsClient } from "./fonts";
import { strokeFontsClient } from "./strokeFonts";
import { gamesClient } from "./games";
import { aiClient } from "./ai";
import { settingsClient } from "./settings";

export const api = {
  ...authClient,
  ...calibrationClient,
  ...jobsClient,
  ...printerClient,
  ...paperClient,
  ...paintClient,
  ...sourcesClient,
  ...galleryClient,
  ...fontsClient,
  ...strokeFontsClient,
  ...gamesClient,
  ...aiClient,
  ...settingsClient,
};
