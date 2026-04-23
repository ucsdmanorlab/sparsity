"""Convert local zarr arrays to Neuroglancer precomputed volumes under public/data/.

One-shot script. Reads zarrs from /Users/vijay/work/test_vols/website_vols/,
writes precomputed output suitable for static HTTPS hosting (GitHub Pages).
"""
from pathlib import Path
import numpy as np
import zarr
from cloudvolume import CloudVolume

SRC = Path("/Users/vijay/work/test_vols/website_vols")
DST = Path("/Users/vijay/work/sparsity/sparsity.github.io/public/data")

# (src_zarr, array_name, dest_dataset, dest_layer, layer_type)
JOBS = [
    # HARRIS-15 (voljo.zarr -> harris_15)
    ("voljo.zarr", "raw",              "harris_15", "raw",              "image"),
    ("voljo.zarr", "3d_dense",         "harris_15", "3d_baseline",      "segmentation"),
    ("voljo.zarr", "dense_labels",     "harris_15", "gt_labels",        "segmentation"),
    ("voljo.zarr", "sparse_2d_labels", "harris_15", "sparse_labels",    "segmentation"),
    ("voljo.zarr", "10min_paint_2d",   "harris_15", "segmentation",     "segmentation"),
    # EPI
    ("epi.zarr", "raw",                "epi", "raw",                "image"),
    ("epi.zarr", "labels_dense",       "epi", "gt",                 "segmentation"),
    ("epi.zarr", "labels_dense1z",     "epi", "gt_1section",        "segmentation"),
    ("epi.zarr", "seg_dense",          "epi", "seg_dense",          "segmentation"),
    ("epi.zarr", "seg_dense1z",        "epi", "seg_dense_1section", "segmentation"),
    ("epi.zarr", "seg_sparsesam",      "epi", "seg_sparsesam",      "segmentation"),
    ("epi.zarr", "useg_EE",            "epi", "useg_EE",            "segmentation"),
    ("epi.zarr", "simple_thresh_ws_f", "epi", "thresh_ws",          "segmentation"),
    # LICONN
    ("liconn.zarr", "raw",               "liconn", "raw",     "image"),
    ("liconn.zarr", "labels_relabeled",  "liconn", "gt",      "segmentation"),
    ("liconn.zarr", "sparse_labels",     "liconn", "sparse",  "segmentation"),
    ("liconn.zarr", "seg",               "liconn", "seg",     "segmentation"),
    # Synthetic — three batches (60001 / 60004 / 60007)
    *[item for batch in ("batch_60001", "batch_60004", "batch_60007") for item in [
        (f"synthetic/{batch}.zarr", "labels",            "synthetic", f"{batch}/labels",            "segmentation"),
        (f"synthetic/{batch}.zarr", "obfuscated_labels", "synthetic", f"{batch}/obfuscated_labels", "segmentation"),
        (f"synthetic/{batch}.zarr", "input_lsds",        "synthetic", f"{batch}/input_lsds",        "image"),
        (f"synthetic/{batch}.zarr", "gt_affs",           "synthetic", f"{batch}/gt_affs",           "image"),
        (f"synthetic/{batch}.zarr", "pred_affs",         "synthetic", f"{batch}/pred_affs",         "image"),
    ]],
]


def pick_chunk_size(volume_size, block_multiple=None):
    """Pick a chunk size <= 64 per dim, >= 1, optionally multiple of block_multiple."""
    chunks = []
    for s in volume_size:
        c = min(64, max(1, s))
        if block_multiple is not None and c >= block_multiple:
            c = (c // block_multiple) * block_multiple
        chunks.append(c)
    return chunks


def convert(src_zarr, name, dst_ds, dst_layer, layer_type):
    arr = zarr.open(str(SRC / src_zarr / name), mode="r")
    attrs = dict(arr.attrs)
    vox_zyx = list(attrs.get("voxel_size", [1, 1, 1]))
    offset_zyx = list(attrs.get("offset", [0, 0, 0]))

    data = arr[:]

    if data.ndim == 4:
        # (c, z, y, x)
        num_channels = int(data.shape[0])
        # Transpose -> (x, y, z, c)
        data_tr = np.ascontiguousarray(data.transpose(3, 2, 1, 0))
        volume_size = [int(data_tr.shape[0]), int(data_tr.shape[1]), int(data_tr.shape[2])]
    elif data.ndim == 3:
        num_channels = 1
        # (z, y, x) -> (x, y, z)
        data_tr = np.ascontiguousarray(data.transpose(2, 1, 0))
        volume_size = [int(data_tr.shape[0]), int(data_tr.shape[1]), int(data_tr.shape[2])]
    else:
        raise ValueError(f"unexpected ndim={data.ndim} for {src_zarr}/{name}")

    # Resolution in nm, XYZ order (from zarr's ZYX order)
    resolution = [int(vox_zyx[2]), int(vox_zyx[1]), int(vox_zyx[0])]
    # Voxel offset in voxels, XYZ order
    voxel_offset = [
        int(round(offset_zyx[2] / vox_zyx[2])) if vox_zyx[2] else 0,
        int(round(offset_zyx[1] / vox_zyx[1])) if vox_zyx[1] else 0,
        int(round(offset_zyx[0] / vox_zyx[0])) if vox_zyx[0] else 0,
    ]

    if layer_type == "image":
        # For synthetic LSDs/affs (float32 in [0,1]), rescale to uint8 [0,255].
        # Much smaller on disk, and toNormalized() in NG shaders expects uint8.
        if data_tr.dtype in (np.float32, np.float64):
            data_tr = np.clip(data_tr, 0.0, 1.0)
            data_tr = (data_tr * 255.0).astype(np.uint8)
        # uint8 single-channel -> jpeg (much smaller, static-HTTP-safe).
        # Multi-channel uint8 (affs, LSDs) -> raw (jpeg only supports 1ch).
        if data_tr.dtype == np.uint8 and num_channels == 1:
            encoding = "jpeg"
        else:
            encoding = "raw"
        data_type = str(data_tr.dtype)
        chunk_size = pick_chunk_size(volume_size)
    else:
        # Segmentation must be uint32/uint64
        if data_tr.dtype not in (np.uint32, np.uint64):
            data_tr = data_tr.astype(np.uint64)
        data_type = str(data_tr.dtype)
        # compressed_segmentation needs num_channels=1 and each dim >= 8
        if num_channels == 1 and min(volume_size) >= 8:
            encoding = "compressed_segmentation"
            chunk_size = pick_chunk_size(volume_size, block_multiple=8)
        else:
            encoding = "raw"
            chunk_size = pick_chunk_size(volume_size)

    dst_path = DST / dst_ds / dst_layer
    dst_path.mkdir(parents=True, exist_ok=True)

    info = CloudVolume.create_new_info(
        num_channels=num_channels,
        layer_type=layer_type,
        data_type=data_type,
        encoding=encoding,
        resolution=resolution,
        voxel_offset=voxel_offset,
        volume_size=volume_size,
        chunk_size=chunk_size,
    )
    if encoding == "compressed_segmentation":
        info["scales"][0]["compressed_segmentation_block_size"] = [8, 8, 8]

    # compress=False avoids writing ".gz"-suffixed chunks, which Neuroglancer
    # can't find when the path is served by static HTTP (no content-encoding
    # negotiation on the chunk name itself). jpeg + compressed_segmentation
    # already provide format-level compression; raw float arrays are small.
    vol = CloudVolume(f"file://{dst_path}", info=info, compress=False, progress=False)
    vol.commit_info()
    if num_channels > 1:
        vol[:, :, :, :] = data_tr
    else:
        vol[:, :, :] = data_tr
    print(f"  wrote {dst_ds}/{dst_layer}  size={volume_size}  res={resolution}  "
          f"offset={voxel_offset}  ch={num_channels}  dtype={data_type}  enc={encoding}")


def build_epi_sparse_sam_union():
    """Union three single-section SAM label crops into one sparse volume.

    epi.zarr/training_crops_raw/location_{107,270,392}_*/labels each contain
    one labeled z-section. We want them combined into a single (540,733,391)
    uint64 array at voxel_size [1,1,1] nm so Neuroglancer can show them as a
    single 'Sparse SAM labels' layer over the full EPI volume.
    """
    full_shape_zyx = (540, 733, 391)
    out = np.zeros(full_shape_zyx, dtype=np.uint64)
    locs = ["location_107_168_200", "location_270_393_167", "location_392_322_119"]
    label_offset = 0
    for loc in locs:
        a = zarr.open(str(SRC / "epi.zarr" / "training_crops_raw" / loc / "labels"), mode="r")
        arr = a[:]  # (1, y, x)
        offset_zyx = list(a.attrs.get("offset", [0, 0, 0]))
        # Add per-location label offset so the three arrays don't collide
        arr_u64 = arr.astype(np.uint64)
        mask = arr_u64 > 0
        arr_u64[mask] += label_offset
        label_offset = int(arr_u64.max()) if mask.any() else label_offset
        z, y, x = offset_zyx
        dz, dy, dx = arr_u64.shape
        out[z:z+dz, y:y+dy, x:x+dx] = np.where(
            arr_u64 > 0,
            arr_u64,
            out[z:z+dz, y:y+dy, x:x+dx],
        )

    # Transpose (z,y,x) -> (x,y,z) for precomputed
    data_tr = np.ascontiguousarray(out.transpose(2, 1, 0))
    volume_size = list(data_tr.shape)
    chunk_size = pick_chunk_size(volume_size, block_multiple=8)

    dst_path = DST / "epi" / "sparse_sam"
    dst_path.mkdir(parents=True, exist_ok=True)
    info = CloudVolume.create_new_info(
        num_channels=1,
        layer_type="segmentation",
        data_type="uint64",
        encoding="compressed_segmentation",
        resolution=[1, 1, 1],
        voxel_offset=[0, 0, 0],
        volume_size=volume_size,
        chunk_size=chunk_size,
    )
    info["scales"][0]["compressed_segmentation_block_size"] = [8, 8, 8]
    vol = CloudVolume(f"file://{dst_path}", info=info, compress=False, progress=False)
    vol.commit_info()
    vol[:] = data_tr
    print(f"  wrote epi/sparse_sam  size={volume_size}  (union of {len(locs)} labeled sections)")


def main():
    for job in JOBS:
        try:
            convert(*job)
        except Exception as e:
            print(f"FAILED {job}: {type(e).__name__}: {e}")
            raise
    build_epi_sparse_sam_union()


if __name__ == "__main__":
    main()
