"""Generate precomputed meshes for segmentation layers so Neuroglancer can
render 3D meshes when a user clicks a label.

Writes to public/data/<dataset>/<layer>/mesh/ (sharded or unsharded mesh
fragments per segment plus a manifest per segment).

Idempotent: re-running regenerates meshes in place.
"""
from pathlib import Path
from taskqueue import LocalTaskQueue
import igneous.task_creation as tc

DST = Path("/Users/vijay/work/sparsity/sparsity.github.io/public/data")

# (dataset, layer) — only include volumes where 3D meshes are meaningful
# (i.e. skip single-section or 3-section sparse labels).
LAYERS = [
    ("harris_15", "3d_baseline"),
    ("harris_15", "gt_labels"),
    ("harris_15", "segmentation"),
    ("epi", "gt"),
    ("epi", "seg_dense"),
    ("epi", "seg_dense_1section"),
    ("epi", "seg_sparsesam"),
    ("epi", "useg_EE"),
    ("epi", "thresh_ws"),
    ("epi", "sparse_sam"),
    ("liconn", "gt"),
    ("liconn", "seg"),
    ("synthetic", "batch_60001/labels"),
    ("synthetic", "batch_60004/labels"),
    ("synthetic", "batch_60007/labels"),
]


def mesh_one(dataset, layer):
    layer_path = f"file://{DST / dataset / layer}"
    print(f"[{dataset}/{layer}]  meshing (unsharded legacy precomputed) → {layer_path}")
    # Only the legacy unsharded precomputed format (`<segid>:<lod>` manifest
    # + `<segid>:<lod>:<bbox>` raw-triangle fragments) actually renders on
    # neuroglancer-demo.appspot.com. Sharded / multilod / draco variants
    # have subtle incompatibilities with the demo build and silently fail.
    # Accept the ~10x larger on-disk size as the price of compatibility.
    with LocalTaskQueue(parallel=4) as tq:
        tasks = tc.create_meshing_tasks(
            layer_path,
            mip=0,
            shape=(256, 256, 256),
            simplification=True,
            max_simplification_error=40,
            # Skip meshes for segments <100 voxels — these are tiny noise
            # fragments that don't render usefully in 3D and bloat disk.
            dust_threshold=100,
            mesh_dir="mesh",
            encoding="precomputed",
            compress=None,
        )
        tq.insert(tasks)
    with LocalTaskQueue(parallel=4) as tq:
        tasks = tc.create_mesh_manifest_tasks(layer_path, mesh_dir="mesh")
        tq.insert(tasks)


def main():
    for dataset, layer in LAYERS:
        try:
            mesh_one(dataset, layer)
        except Exception as e:
            print(f"FAILED {dataset}/{layer}: {type(e).__name__}: {e}")


if __name__ == "__main__":
    main()
