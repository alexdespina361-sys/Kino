"""
Makes public/labs/upscale/rife/rife-v4.25-lite-motion.onnx from rife-v4.25-lite.onnx next to it: RIFE 4.25 lite without its last step. Its one
output, "flowmask" [1, 5, h, w], is the network's motion (4 channels: where to look in frame 0, then in frame 1, in pixels) and its mask (after the
sigmoid); the two warps and the blend after them are left out, and the upscaler test page does them at the video's full size
(src/labs/upscale/frameBoost.ts `warp`), so that the motion can be found on smaller pictures.

The same network, the same weights (nothing retrained, nothing changed but the cut). The first size of the inputs and the output is named "n"
instead of a fixed 1, so that several moments are made in one run (the network has no other place that fixes it: a batch of two gives exactly what
two runs of one give, checked on the processor). onnx 1.17 or newer.

python -I scripts/labs/rife-cut-motion.py public/labs/upscale/rife/rife-v4.25-lite.onnx public/labs/upscale/rife/rife-v4.25-lite-motion.onnx
"""
import sys

import onnx
from onnx import helper, TensorProto

FLOW = "/n/Add_35_output_0"
MASK = "/n/Sigmoid_output_0"

model = onnx.load(sys.argv[1])
graph = model.graph
graph.node.append(helper.make_node("Concat", [FLOW, MASK], ["flowmask"], axis=1, name="flowmask_concat"))
while len(graph.output):
    graph.output.pop()
graph.output.append(helper.make_tensor_value_info("flowmask", TensorProto.FLOAT, [1, 5, "h", "w"]))

# Drop what no output needs any more (the warps, the blend, the clip), walking back from the output.
needed = {"flowmask"}
producer = {out: node for node in graph.node for out in node.output}
stack = ["flowmask"]
while stack:
    name = stack.pop()
    node = producer.get(name)
    if node is None:
        continue
    for each in node.input:
        if each and each not in needed:
            needed.add(each)
            stack.append(each)
kept = [node for node in graph.node if any(out in needed for out in node.output)]
dropped = len(graph.node) - len(kept)
del graph.node[:]
graph.node.extend(kept)
used = {each for node in graph.node for each in node.input}
inits = [init for init in graph.initializer if init.name in used]
del graph.initializer[:]
graph.initializer.extend(inits)
# Several moments in one run: the batch size named, not fixed at 1.
for each in list(graph.input) + list(graph.output):
    first = each.type.tensor_type.shape.dim[0]
    first.ClearField("dim_value")
    first.dim_param = "n"
onnx.checker.check_model(model)
onnx.save(model, sys.argv[2])
print("kept", len(kept), "nodes, dropped", dropped)
