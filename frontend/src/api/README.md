# `src/api`

Barrel re-export of all API types and the unified `api` client object.
The original `src/api.ts` is now a two-line barrel that forwards everything
from this directory, so all existing `import { api, type Foo } from "../api"`
paths continue to work without change.

```
api/
├── types/               TypeScript interface definitions, no runtime code
│   ├── auth.ts          AuthSession, AuthSetupStart, AuthSetupFinish
│   ├── calibration.ts   Obstacle, Calibration, CalibrationProfile*, ProfileRef, JobProfileStatus
│   ├── sources.ts       SourcePage, Source, SourcePreview
│   ├── gallery.ts       GalleryScore, GalleryItem, GallerySvg, GalleryPreview, …
│   ├── paint.ts         ColoringColor, SceneObject, Page, PageIndex, PageScore, …
│   ├── jobs.ts          Job, Position, PaperState, GcodePreview, GcodePreview3D, …
│   ├── games.ts         MazeResponse, SudokuResponse, OsmMapRequest, …
│   ├── ai.ts            AiImageStatus, AiImageQuality, AiImageResult
│   ├── settings.ts      AppSettings, EffectiveSettings
│   └── index.ts         Re-exports all type modules
│
└── client/              Runtime fetch wrappers — one file per domain
    ├── req.ts           Shared fetch helper with error handling
    ├── auth.ts          /api/auth/* endpoints
    ├── calibration.ts   /api/calibration/* endpoints
    ├── jobs.ts          /api/jobs/* endpoints
    ├── printer.ts       /api/printer/* endpoints
    ├── paper.ts         /api/paper/* endpoints
    ├── paint.ts         /api/paint/* endpoints
    ├── sources.ts       /api/sources/* endpoints
    ├── gallery.ts       /api/gallery/* endpoints
    ├── games.ts         /api/games/* endpoints  (+ mazeSizeValue helper)
    ├── ai.ts            /api/ai/* endpoints
    ├── settings.ts      /api/settings/* endpoints
    └── index.ts         Assembles all client modules into the single `api` object
```

## Dependency order of type files

Types are layered to avoid circular imports:

```
calibration  ←  sources  ←  gallery  ←  paint  ←  jobs
                                  ↑
                                  ai
```

`jobs.ts` references `Calibration` via an inline `import()` to break the
otherwise circular dependency with `calibration.ts`.
