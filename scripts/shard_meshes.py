"""Convert unsharded meshes (from generate_meshes.py) into sharded
multi-resolution Draco-compressed meshes — the Seung Lab standard for
large datasets served over static HTTP.

For each layer:
  1. Build sharded-multires Draco meshes in the same mesh_dir (uses the
     spatial index fragments that generate_meshes.py already left behind).
  2. Delete the original unsharded mesh fragments (.shard files remain).

Expected reduction: 5-20x smaller. Neuroglancer uses HTTP range requests
on the .shard files, which GitHub Pages supports.
"""
from pathlib import Path
from taskqueue import LocalTaskQueue
import igneous.task_creation as tc

DST = Path("/Users/vijay/work/sparsity/sparsity.github.io/public/data")

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
    ("liconn", "gt"),
    ("liconn", "seg"),
    ("synthetic", "batch_60001/labels"),
    ("synthetic", "batch_60004/labels"),
    ("synthetic", "batch_60007/labels"),
]


def shard_one(dataset, layer):
    layer_path = f"file://{DST / dataset / layer}"
    mesh_dir = DST / dataset / layer / "mesh"
    print(f"[{dataset}/{layer}] shard + multires + draco → {layer_path}")

    # Sharded multi-resolution mesh generation.
    # - draco_compression_level=7: max lossy compression, standard for Pages.
    # - num_lod=2: 3 LODs (0,1,2) for zoom-dependent rendering.
    # - vertex_quantization_bits=16: sub-nm precision, fine for us.
    with LocalTaskQueue(parallel=4) as tq:
        tasks = tc.create_sharded_multires_mesh_tasks(
            layer_path,
            num_lod=2,
            draco_compression_level=7,
            vertex_quantization_bits=16,
            minishard_index_encoding="gzip",
            progress=False,
        )
        tq.insert(tasks)

    # Clean up unsharded mesh fragment files (keep .shard files and info).
    # Unsharded fragments look like `<segid>:0` and `<segid>:0:<key>`.
    # Sharded files look like `<hex>.shard`.
    if mesh_dir.exists():
        removed = 0
        for f in mesh_dir.iterdir():
            if f.is_file() and ":" in f.name:
                f.unlink()
                removed += 1
        # spatial index fragments are directories; leave them — small and
        # are consumed by any future re-sharding.
        print(f"    removed {removed} unsharded fragment files")


def main():
    for dataset, layer in LAYERS:
        try:
            shard_one(dataset, layer)
        except Exception as e:
            print(f"FAILED {dataset}/{layer}: {type(e).__name__}: {e}")


if __name__ == "__main__":
    main()
