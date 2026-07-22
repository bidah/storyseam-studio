// The React Flow nodeTypes map for the Visual nodes canvas, keyed by node type.
import ImageFlowNode from "./ImageFlowNode";
import VideoFlowNode from "./VideoFlowNode";
import TextNode from "./TextNode";
import UploadNode from "./UploadNode";

export const nodeTypes = {
  image: ImageFlowNode,
  video: VideoFlowNode,
  text: TextNode,
  upload: UploadNode,
};

export default nodeTypes;
