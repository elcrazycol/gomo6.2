import { renderBbCode } from "./bbcodePlugins";

export const processProfileBio = (bio: string, keyPrefix: string = 'bio'): React.ReactNode => {
  if (!bio) return null;
  return renderBbCode(bio, { keyPrefix });
};
