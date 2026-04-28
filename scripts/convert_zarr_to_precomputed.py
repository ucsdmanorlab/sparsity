"""Convert local zarr arrays to Neuroglancer precomputed volumes under public/data/.

One-shot script. Reads zarrs from /Users/vijay/work/test_vols/website_vols/,
writes precomputed output suitable for static HTTPS hosting (GitHub Pages).
"""
from pathlib import Path
import numpy as np
import zarr
import cc3d
from cloudvolume import CloudVolume

SRC = Path("/Users/vijay/work/test_vols/website_vols")
DST = Path("/Users/vijay/work/sparsity/sparsity.github.io/public/data")

# Each job: dict with required keys (src_zarr, name, dst_ds, dst_layer, layer_type)
# and optional (crop_roi_from, mask_from, y_crop_start) passed to convert().
def _j(src_zarr, name, dst_ds, dst_layer, layer_type, **extras):
    return dict(src_zarr=src_zarr, name=name, dst_ds=dst_ds,
                dst_layer=dst_layer, layer_type=layer_type, **extras)

# HARRIS: every array cropped to dense_labels' ROI; segmentation layers
# (3D baseline, 10-min bootstrap) additionally masked by dense_labels_mask.
# All HARRIS segmentation layers are relabeled by 26-connectivity components
# so cropping/masking doesn't leave disjoint blobs sharing an id.
HARRIS_CROP = {"crop_roi_from": "voljo.zarr/dense_labels"}
HARRIS_CROP_MASK = {**HARRIS_CROP, "mask_from": "voljo.zarr/dense_labels_mask"}
HARRIS_SEG_CROP = {**HARRIS_CROP, "relabel_cc": True}
HARRIS_SEG_CROP_MASK = {**HARRIS_CROP_MASK, "relabel_cc": True}

# EPI: drop first 95 y voxels across every array.
EPI_YCROP = {"y_crop_start": 95}

JOBS = [
    # HARRIS-15 (voljo.zarr -> harris_15) — cropped to dense_labels ROI
    _j("voljo.zarr", "raw",              "harris_15", "raw",           "image",        **HARRIS_CROP),
    _j("voljo.zarr", "3d_dense",         "harris_15", "3d_baseline",   "segmentation", **HARRIS_SEG_CROP_MASK),
    _j("voljo.zarr", "dense_labels",     "harris_15", "gt_labels",     "segmentation", **HARRIS_SEG_CROP),
    _j("voljo.zarr", "sparse_2d_labels", "harris_15", "sparse_labels", "segmentation", **HARRIS_SEG_CROP),
    _j("voljo.zarr", "10min_paint_2d",   "harris_15", "segmentation",  "segmentation", **HARRIS_SEG_CROP_MASK),
    # EPI — drop first 95 y voxels on every array
    _j("epi.zarr", "raw",                "epi", "raw",                "image",        **EPI_YCROP),
    _j("epi.zarr", "labels_dense",       "epi", "gt",                 "segmentation", **EPI_YCROP),
    _j("epi.zarr", "labels_dense1z",     "epi", "gt_1section",        "segmentation", **EPI_YCROP),
    _j("epi.zarr", "seg_dense",          "epi", "seg_dense",          "segmentation", **EPI_YCROP),
    _j("epi.zarr", "seg_dense1z",        "epi", "seg_dense_1section", "segmentation", **EPI_YCROP),
    _j("epi.zarr", "seg_sparsesam",      "epi", "seg_sparsesam",      "segmentation", **EPI_YCROP),
    _j("epi.zarr", "useg_EE",            "epi", "useg_EE",            "segmentation", **EPI_YCROP),
    _j("epi.zarr", "simple_thresh_ws_f", "epi", "thresh_ws",          "segmentation", **EPI_YCROP),
    # LICONN
    _j("liconn.zarr", "raw",              "liconn", "raw",    "image"),
    _j("liconn.zarr", "labels_relabeled", "liconn", "gt",     "segmentation"),
    _j("liconn.zarr", "sparse_labels",    "liconn", "sparse", "segmentation"),
    _j("liconn.zarr", "seg",              "liconn", "seg",    "segmentation"),
    # Synthetic — three batches (60001 / 60004 / 60007)
    *[j for batch in ("batch_60001", "batch_60004", "batch_60007") for j in [
        _j(f"synthetic/{batch}.zarr", "labels",            "synthetic", f"{batch}/labels",            "segmentation"),
        _j(f"synthetic/{batch}.zarr", "obfuscated_labels", "synthetic", f"{batch}/obfuscated_labels", "segmentation"),
        _j(f"synthetic/{batch}.zarr", "input_lsds",        "synthetic", f"{batch}/input_lsds",        "image"),
        _j(f"synthetic/{batch}.zarr", "gt_affs",           "synthetic", f"{batch}/gt_affs",           "image"),
        _j(f"synthetic/{batch}.zarr", "pred_affs",         "synthetic", f"{batch}/pred_affs",         "image"),
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


def _load_zarr_with_attrs(path):
    a = zarr.open(str(path), mode="r")
    attrs = dict(a.attrs)
    return a, list(attrs.get("voxel_size", [1, 1, 1])), list(attrs.get("offset", [0, 0, 0]))


def _crop_to_roi(data, vox_zyx, offset_zyx, roi_offset_zyx, roi_shape_zyx, roi_vox_zyx):
    """Crop a (z,y,x) array to the world-space ROI of another array (same
    voxel size assumed). Returns (cropped_data, new_offset_zyx).
    """
    assert tuple(vox_zyx) == tuple(roi_vox_zyx), "ROI crop assumes matched voxel sizes"
    roi_world_start = roi_offset_zyx
    roi_world_end = [roi_offset_zyx[i] + roi_shape_zyx[i] * roi_vox_zyx[i] for i in range(3)]
    # Compute crop indices local to `data` (z,y,x order)
    start_vox = [max(0, int(round((roi_world_start[i] - offset_zyx[i]) / vox_zyx[i]))) for i in range(3)]
    end_vox   = [min(data.shape[i], int(round((roi_world_end[i] - offset_zyx[i]) / vox_zyx[i]))) for i in range(3)]
    sl = tuple(slice(start_vox[i], end_vox[i]) for i in range(3))
    new_offset = [offset_zyx[i] + start_vox[i] * vox_zyx[i] for i in range(3)]
    return data[sl], new_offset


def convert(src_zarr, name, dst_ds, dst_layer, layer_type,
            crop_roi_from=None, mask_from=None, y_crop_start=None,
            relabel_cc=False):
    """
    crop_roi_from: optional "path/within/SRC" of a zarr whose offset+shape
        defines the world-space ROI to crop `data` to.
    mask_from: optional "path/within/SRC" of a binary mask; applied after crop.
        Where mask == 0, output is zeroed.
    y_crop_start: optional int, drop the first N voxels along the y axis
        (axis 1 in zarr-native zyx layout).
    relabel_cc: optional bool, after crop/mask reassign every spatially
        connected component (26-connectivity) to a unique label. Use for
        segmentations whose original ids may be split into disjoint blobs
        by cropping or masking.
    """
    arr, vox_zyx, offset_zyx = _load_zarr_with_attrs(SRC / src_zarr / name)

    data = arr[:]

    # Crop to another array's world ROI (HARRIS: dense_labels ROI)
    if crop_roi_from is not None and data.ndim == 3:
        roi_a, roi_vox, roi_off = _load_zarr_with_attrs(SRC / crop_roi_from)
        data, offset_zyx = _crop_to_roi(data, vox_zyx, offset_zyx,
                                        roi_off, list(roi_a.shape), roi_vox)

    # Simple y-axis crop (EPI: drop first N y voxels)
    if y_crop_start is not None and data.ndim == 3 and y_crop_start > 0:
        data = data[:, y_crop_start:, :]
        offset_zyx = [offset_zyx[0], offset_zyx[1] + y_crop_start * vox_zyx[1], offset_zyx[2]]

    # Apply a binary mask (HARRIS: dense_labels_mask)
    if mask_from is not None and data.ndim == 3:
        mask_a, mask_vox, mask_off = _load_zarr_with_attrs(SRC / mask_from)
        mask_data = mask_a[:]
        # Align mask to `data`'s current ROI (same voxel size assumed)
        assert tuple(mask_vox) == tuple(vox_zyx), "mask must share voxel size"
        mstart = [int(round((offset_zyx[i] - mask_off[i]) / mask_vox[i])) for i in range(3)]
        mend = [mstart[i] + data.shape[i] for i in range(3)]
        mask_data = mask_data[mstart[0]:mend[0], mstart[1]:mend[1], mstart[2]:mend[2]]
        assert mask_data.shape == data.shape, f"mask shape {mask_data.shape} != data {data.shape}"
        data = np.where(mask_data > 0, data, 0)

    # Connected-components relabel (HARRIS segmentations after crop/mask).
    # cc3d treats different input labels as already-distinct, and splits any
    # single label whose voxels form multiple disjoint components.
    if relabel_cc and data.ndim == 3:
        n_before = int(np.unique(data).size) - (1 if (data == 0).any() else 0)
        data = cc3d.connected_components(data, connectivity=26)
        n_after = int(data.max())
        # Promote to uint64 so downstream segmentation encoder sees a valid
        # segmentation dtype regardless of cc3d's chosen output dtype.
        data = data.astype(np.uint64)
        print(f"  cc3d relabel {dst_ds}/{dst_layer}: {n_before} ids -> {n_after} components")

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
        a = zarr.open(str(SRC / "epi_crops" / loc / "labels"), mode="r")
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

    # Crop y[95:] to match the rest of the EPI volume set.
    out = out[:, 95:, :]
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
        voxel_offset=[0, 95, 0],  # matches y-cropped EPI volumes
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
            convert(**job)
        except Exception as e:
            print(f"FAILED {job}: {type(e).__name__}: {e}")
            raise
    build_epi_sparse_sam_union()


if __name__ == "__main__":
    main()
