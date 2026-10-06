import { registerAchievementsRouteData } from "./achievementsData";
import { registerBoardRouteData } from "./boardData";
import { registerGomoSubRouteData } from "./gomosubData";
import { registerProfileRouteData } from "./profileData";
import { registerThreadRouteData } from "./threadData";

/**
 * Importing this module registers every route-data preloader exactly once.
 * `App.tsx` imports it for its side effect, mirroring the old
 * `@/pages/profile/profilePreload` entry point.
 */
registerProfileRouteData();
registerBoardRouteData();
registerThreadRouteData();
registerAchievementsRouteData();
registerGomoSubRouteData();

export {};
