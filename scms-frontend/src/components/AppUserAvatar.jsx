import { useEffect, useState } from "react";
import { getAppUserPhoto, getSeniorPhoto } from "../services/api";
import "./AppUserAvatar.css";

/**
 * Round avatar for someone who uses the senior app: their app-profile photo
 * when they set one, otherwise whatever fallback the page passes as children
 * (usually initials).
 *
 * Each page keeps its own avatar classes (dv-avatar, um-avatar, ...); only
 * the photo itself is shared. Identify the person by their app account
 * (appAccountId) or by their senior citizen record (seniorId) — whichever the
 * page has. With neither, or with no photo, the fallback stays on screen.
 */
export default function AppUserAvatar({
  appAccountId,
  seniorId,
  hasPhoto = true,
  className = "",
  children,
}) {
  const [url, setUrl] = useState(null);

  const wantsPhoto = Boolean(appAccountId || seniorId) && hasPhoto;

  useEffect(() => {
    if (!wantsPhoto) return undefined;

    let alive = true;
    let objectUrl = null;

    const load = appAccountId
      ? getAppUserPhoto(appAccountId)
      : getSeniorPhoto(seniorId);

    load
      .then((blob) => {
        if (!alive) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => {
        if (alive) setUrl(null);
      });

    return () => {
      alive = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [wantsPhoto, appAccountId, seniorId]);

  return (
    <span className={`app-avatar ${className}`.trim()}>
      {url ? <img src={url} alt="" className="app-avatar-img" /> : children}
    </span>
  );
}
