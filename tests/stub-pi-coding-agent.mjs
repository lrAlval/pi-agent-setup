export const convertToLlm = (messages) => messages;

export class CustomEditor {
  constructor() {
    this.text = "";
    this.inputs = [];
  }
  getText() { return this.text; }
  setText(t) { this.text = t; }
  handleInput(data) { this.inputs.push(data); this.text += data; }
  render() { return ["", "   "]; }
}
