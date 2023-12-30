import { Component } from "@/utils/component";
import { hbs } from "@/utils/template";
import { tracked } from "@/utils/tracked";

type InputArgs = {
  value: string;
};

export class Input extends Component<InputArgs> {
    @tracked value = 12;
  onChange = (e: Event) => {
    console.log("change", e);
  };
  static template = hbs`<input
        {{on 'change' this.onChange}} 
        type="text" 
        value={{@value}}
     />`;
}
