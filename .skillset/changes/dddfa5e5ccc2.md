---
bump: patch
evidence:
  - scope: plugin.skillset.skill:use-skillset
    sourceHash: sha256:2efe13881d5220bd5a36e6876f67df091be17d5abae117e7bb4d930c15b3de15
  - scope: plugin:skillset
    sourceHash: sha256:98a7b706dfc46f752dc086844c1128ef0385305111c8c048e087accd26033eba
  - scope: plugin.skillset.skill:use-skillset
    sourceHash: sha256:df39a5a7fe8987f0380f78eafa914b7b71c1629aa8cd9a2a7279562abcf16cdc
  - scope: plugin:skillset
    sourceHash: sha256:4c948baaa930922cd9442d0405be9976d274ecad2d56fc41dfebab557f405f77
  - scope: plugin.skillset.skill:use-skillset
    sourceHash: sha256:67003ba5ab05aac45259105d132f777359010d64218cc1c0eca08b5326809479
  - scope: plugin:skillset
    sourceHash: sha256:2b23203c45a3b1e50bc9e6783e989c72e778b73754b8880fc37eddb916dc3bf3
group: SET-139
id: dddfa5e5ccc2
scopes:
  - plugin.skillset.skill:use-skillset
  - plugin:skillset
---

Update setup guidance for the unified source scaffold now that init/create create the main .skillset/src source-family directories by default and reserve --include for optional CI only.
