function MVVM(options) {
  this.$data = options.data;
  this.$methods = options.methods;
  this.$el = options.el;
  // 保存data的每个属性对应的watcher，分成指令和文本两种，实现model和view的一对多绑定
  this._binding  = {};
  this._observer(options.data);
  this._compile();
  // this.xxx 代理this.$data.xxx
  this.proxyAttribute();
}

// 将this.<attr>的调用代理到this.$data.<attr>上，同时this.<attr>的值的改变也会同步到this.$data.<attr上>
MVVM.prototype.proxyAttribute = function() {
  var keys = Object.keys(this.$data);
  var self = this;
  for(var i = 0; i < keys.length; i++) {
    var key = keys[i];
    (function(key) {
      Object.defineProperty(self, key, {
        enumerable: true,
        configurable: true,
        get: function() {
          return self.$data[key];
        },
        set: function(newVal) {
          if(newVal !== self.$data[key]) {
            self.$data[key] = newVal;
          }
        }
      })
    })(key)
  }
}

// 遍历data，通过Object.defineProperty的setter的挟持数据改变，监听到数据改变后发布消息给订阅者watcher
MVVM.prototype._observer = function(data) {
  var self = this;
  for(var key in this.$data) {
    if (this.$data.hasOwnProperty(key)) {
      this._binding[key] = {
        _directives: [],
        _texts: []
      };

      if(typeof this.$data[key] === "object") {
        return this._observer(this.$data[key]);
      }
      var val = data[key];
      (function(value, key) {
        Object.defineProperty(self.$data, key, {
          enumerable: true,
          configurable: true,
          get: function() {
            return value;
          },
          set(newval) {
            if(newval === value) {
              return;
            }
            value = newval;
            // 通知Watcher去更新view指令
            if(self._binding[key]._directives) {
              self._binding[key]._directives.forEach(function(watcher) {
                watcher.update();
              }, self);
            }
            // 通知Watcher去更新view内容
            if(self._binding[key]._texts) {
              self._binding[key]._texts.forEach(function(watcher) {
                watcher.update();
              }, self);
            }
          }
        });
      })(val, key);
    }
  }
}

// 编译指令，将指令中的变量换成(model)数据，并初始化渲染页面。将每个节点绑定更新函数，添加订阅者，当数据改变的时候，更新视图。
MVVM.prototype._compile = function() {
  var dom = document.querySelector(this.$el);
  var children = dom.children;
  var self = this;
  var i = 0, j = 0;
  for(; i < children.length; i++) {
    var node = children[i];
    (function(node) {
      // 编译{{}}里面的内容
      var text = node.innerText;
      var matches = text.match(/{{([^{}]+)}}/g);
      if(matches && matches.length > 0) {
        // 保存和node绑定的data属性
        node.bindingAttributes = [];
        for(j = 0; j < matches.length; j++) {
          // data某个属性
          var attr = matches[j].match(/{{([^{}]+)}}/)[1];
          // 将和该node绑定的data属性保存起来
          node.bindingAttributes.push(attr);
          (function(attr) {
            self._binding[attr]._texts.push(new Watcher(self, attr, function() {
              var innerText = text.replace(new RegExp("{{" + attr + "}}", "g"), self.$data[attr]);
              // 如果该node绑定多个属性
              for(var k = 0; k < node.bindingAttributes.length; k++) {
                if(node.bindingAttributes[k] !== attr) {
                  innerText = innerText.replace("{{" + node.bindingAttributes[k] + "}}", self.$data[node.bindingAttributes[k]]);
                }
              }
              node.innerText = innerText;
            }));
          })(attr);
        }
      }

      // 编译vue指令
      var attributes = node.getAttributeNames();
      for(j = 0; j < attributes.length; j++) {
        // vue指令
        var attribute = attributes[j];
        // DOM attribute
        var domAttr = null;
        // 绑定的data属性
        var vmDataAttr = node.getAttribute(attribute);
        // 更新函数，但observer中model的数据改变的时候，通过Watcher的update调用更新函数，从而更新dom
        var updater = null;
       
        if(/v-bind:([^=]+)/.test(attribute)) {
          // 解析v-bind
          domAttr = RegExp.$1;
          updater = function(val) {
            node[domAttr] = val;
          }
          // data属性绑定多个watcher
          self._binding[vmDataAttr]._directives.push(
            new Watcher(self, vmDataAttr, updater)
          )
        } else if(attribute === "v-model" && (node.tagName = 'INPUT' || node.tagName == 'TEXTAREA')) {
          // 解析v-model
          updater = function(val) {
            node.value = val;
          }
          // data属性绑定多个watcher
          self._binding[vmDataAttr]._directives.push(
            new Watcher(self, vmDataAttr, updater)
          )
          // 监听input/textarea的数据变化，同步到model去
          node.addEventListener("input", function(evt) {
            var $el = evt.currentTarget;
            self.$data[vmDataAttr] = $el.value;
          });
        } else if(/v-on:([^=]+)/.test(attribute)) {
          // 解析v-on
          var event = RegExp.$1;
          var method = vmDataAttr;
          node.addEventListener(event, function(evt) {
            self.$methods[method] && self.$methods[method].call(self, evt);
          });
        }
      }
    })(node);
  }

}
// watcher必须包含update函数，该函数调用compile当中的“更新”函数，传入参数是model对应属性的值
function Watcher(vm, attr, cb) {
  this.vm = vm; // viewmodel
  this.attr = attr; // data的属性，一个watcher订阅一个data属性
  this.cb = cb; // 更新函数，在compile那边定义

  this.update();
}

Watcher.prototype.update = function() {
  this.cb(this.vm.$data[this.attr]);
}