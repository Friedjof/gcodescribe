import { memo, useEffect, useRef, useState } from "react";
import { api, type Job } from "../../../api";
import {
  JobThumbnailCache,
  jobThumbnailKey,
  type JobThumbnail as Thumbnail,
} from "../lib/jobThumbnails";
const thumbnails = new JobThumbnailCache((filename) =>
  api.jobPreview(filename),
);
/** Only visible thumbnails request geometry; cached paths render immediately on view changes. */
export default memo(
  function JobThumbnail({
    job,
  }: {
    job: Pick<Job, "filename" | "created" | "size">;
  }) {
    const key = jobThumbnailKey(job),
      frame = useRef<HTMLSpanElement>(null);
    const [state, setState] = useState<{
      key: string;
      value: Thumbnail | null | undefined;
    }>(() => ({ key, value: thumbnails.peek(key) }));
    const value = state.key === key ? state.value : thumbnails.peek(key);
    useEffect(() => {
      if (value !== undefined) return;
      let alive = true,
        requested = false;
      const request = () => {
        if (requested) return;
        requested = true;
        void thumbnails
          .get(job)
          .then((value) => {
            if (alive) setState({ key, value });
          })
          .catch(() => {
            if (alive) setState({ key, value: null });
          });
      };
      const observer =
        typeof IntersectionObserver === "undefined"
          ? null
          : new IntersectionObserver(
              (entries) => {
                if (entries.some((entry) => entry.isIntersecting)) {
                  request();
                  observer?.disconnect();
                }
              },
              { rootMargin: "100px" },
            );
      if (observer && frame.current) observer.observe(frame.current);
      else request();
      return () => {
        alive = false;
        observer?.disconnect();
      };
    }, [key, value]);
    return (
      <span ref={frame} className="job-thumbnail-frame" aria-hidden="true">
        {value ? (
          <svg
            className="job-thumb-svg"
            viewBox={value.viewBox}
            preserveAspectRatio="xMidYMid meet"
          >
            <path
              d={value.travel}
              className="job-thumb-travel"
              fill="none"
              strokeWidth={value.stroke}
            />
            <path
              d={value.draw}
              className="job-thumb-draw"
              fill="none"
              strokeWidth={value.stroke}
            />
          </svg>
        ) : (
          <span className="job-thumb-placeholder">
            {value === undefined ? "…" : "–"}
          </span>
        )}
      </span>
    );
  },
  (before, after) => jobThumbnailKey(before.job) === jobThumbnailKey(after.job),
);
