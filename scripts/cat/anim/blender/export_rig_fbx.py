# The cat's skeleton, skin and walk as FBX files, for programs that take a rigged character in that form (MoCapAnything's custom rig walkthrough). Run with Blender:
#
#   blender --background --python scripts/cat/anim/blender/export_rig_fbx.py -- MODEL.glb OUT_DIR RIG_NAME
#
# Writes OUT_DIR/RIG_NAME/RIG_NAME.fbx (the skinned mesh and skeleton, the model's own walk baked on its bones: the shortest name in the folder, which is how that program finds the
# "base") and OUT_DIR/RIG_NAME/RIG_NAME-Walk.fbx (the same, as the motion). Development tooling only.
import os
import sys

import bpy

argv = sys.argv[sys.argv.index("--") + 1 :]
glb, out_dir, rig = argv[0], argv[1], argv[2]
folder = os.path.join(out_dir, rig)
os.makedirs(folder, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=glb)
armature = next(o for o in bpy.context.scene.objects if o.type == "ARMATURE")
meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
print("armature", armature.name, "bones", len(armature.data.bones), "meshes", [(m.name, len(m.data.vertices), len(m.vertex_groups), [md.type for md in m.modifiers]) for m in meshes])
# (only the skinned body goes: a mesh the skeleton does not move, such as the model's eye ball, is not part of the animal as the other program sees it)
for m in meshes:
    if not any(md.type == "ARMATURE" for md in m.modifiers) or len(m.vertex_groups) == 0:
        print("leaving out", m.name)
        bpy.data.objects.remove(m, do_unlink=True)
meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
action = armature.animation_data.action if armature.animation_data else None
print("action", action.name if action else None, tuple(action.frame_range) if action else None)

# the glTF importer leaves the model's own scale (a hundredth) and turn on the armature object: they are exported as they are (the program that reads the file works in its own units)
common = dict(
    use_selection=False,
    object_types={"ARMATURE", "MESH"},
    add_leaf_bones=False,
    path_mode="COPY",
    embed_textures=True,
    axis_forward="-Z",
    axis_up="Y",
    apply_scale_options="FBX_SCALE_ALL",
    bake_anim=False,
)

# the walk, baked, in both files: that program wants an action in the base too (it measures what the hips do), and takes the other files as the motions
if not action:
    raise SystemExit("the model has no animation to export")
scene = bpy.context.scene
scene.frame_start = int(action.frame_range[0])
scene.frame_end = int(action.frame_range[1])
# (the importer reads the model's thirty-a-second keys at the scene's rate: the clip is the same length when the scene says so)
scene.render.fps = 24
bake = dict(common)
bake.update(bake_anim=True, bake_anim_use_all_bones=True, bake_anim_use_nla_strips=False, bake_anim_use_all_actions=False, bake_anim_force_startend_keying=True, bake_anim_step=1.0, bake_anim_simplify_factor=0.0)
bpy.ops.export_scene.fbx(filepath=os.path.join(folder, rig + ".fbx"), **bake)
bpy.ops.export_scene.fbx(filepath=os.path.join(folder, rig + "-Walk.fbx"), **bake)
print("done", os.listdir(folder))
