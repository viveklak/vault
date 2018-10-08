import { set } from '@ember/object';
import { hash } from 'rsvp';
import Route from '@ember/routing/route';
import utils from 'vault/lib/key-utils';
import UnloadModelRoute from 'vault/mixins/unload-model-route';

export default Route.extend(UnloadModelRoute, {
  capabilities(secret) {
    const { backend } = this.paramsFor('vault.cluster.secrets.backend');
    let backendModel = this.modelFor('vault.cluster.secrets.backend');
    let backendType = backendModel.get('engineType');
    let version = backendModel.get('options.version');
    let path;
    if (backendType === 'transit') {
      path = backend + '/keys/' + secret;
    } else if (backendType === 'ssh' || backendType === 'aws') {
      path = backend + '/roles/' + secret;
    } else if (version && version === 2) {
      path = backend + '/data/' + secret;
    } else {
      path = backend + '/' + secret;
    }
    return this.store.findRecord('capabilities', path);
  },

  backendType() {
    return this.modelFor('vault.cluster.secrets.backend').get('engineType');
  },

  templateName: 'vault/cluster/secrets/backend/secretEditLayout',

  beforeModel() {
    // currently there is no recursive delete for folders in vault, so there's no need to 'edit folders'
    // perhaps in the future we could recurse _for_ users, but for now, just kick them
    // back to the list
    const { secret } = this.paramsFor(this.routeName);
    const parentKey = utils.parentKeyForKey(secret);
    const mode = this.routeName.split('.').pop();
    if (mode === 'edit' && utils.keyIsFolder(secret)) {
      if (parentKey) {
        return this.transitionTo('vault.cluster.secrets.backend.list', parentKey);
      } else {
        return this.transitionTo('vault.cluster.secrets.backend.list-root');
      }
    }
  },

  modelType(backend, secret) {
    let backendModel = this.modelFor('vault.cluster.secrets.backend', backend);
    let type = backendModel.get('engineType');
    let types = {
      transit: 'transit-key',
      ssh: 'role-ssh',
      aws: 'role-aws',
      pki: secret && secret.startsWith('cert/') ? 'pki-certificate' : 'role-pki',
      cubbyhole: 'secret',
      kv: backendModel.get('modelTypeForKV'),
      generic: backendModel.get('modelTypeForKV'),
    };
    return types[type];
  },

  model(params) {
    let { secret } = params;
    const { backend } = this.paramsFor('vault.cluster.secrets.backend');
    const modelType = this.modelType(backend, secret);

    if (!secret) {
      secret = '\u0020';
    }
    if (modelType === 'pki-certificate') {
      secret = secret.replace('cert/', '');
    }
    return hash({
      secret: this.store.queryRecord(modelType, { id: secret, backend }).then(resp => {
        if (modelType === 'secret-v2') {
          // TODO, find by query param to enable viewing versions
          let version = resp.versions.findBy('version', resp.currentVersion);
          return version.reload().then(() => {
            resp.set('selectedVersion', version);
            return resp;
          });
        }
        return resp;
      }),
      capabilities: this.capabilities(secret),
    });
  },

  setupController(controller, model) {
    this._super(...arguments);
    const { secret } = this.paramsFor(this.routeName);
    const { backend } = this.paramsFor('vault.cluster.secrets.backend');
    const preferAdvancedEdit =
      this.controllerFor('vault.cluster.secrets.backend').get('preferAdvancedEdit') || false;
    const backendType = this.backendType();
    model.secret.setProperties({ backend });
    controller.setProperties({
      model: model.secret,
      capabilities: model.capabilities,
      baseKey: { id: secret },
      // mode will be 'show', 'edit', 'create'
      mode: this.routeName
        .split('.')
        .pop()
        .replace('-root', ''),
      backend,
      preferAdvancedEdit,
      backendType,
    });
  },

  resetController(controller) {
    if (controller.reset && typeof controller.reset === 'function') {
      controller.reset();
    }
  },

  actions: {
    error(error) {
      const { secret } = this.paramsFor(this.routeName);
      const { backend } = this.paramsFor('vault.cluster.secrets.backend');
      set(error, 'keyId', backend + '/' + secret);
      set(error, 'backend', backend);
      return true;
    },

    refreshModel() {
      this.refresh();
    },

    willTransition(transition) {
      if (this.get('hasChanges')) {
        if (
          window.confirm(
            'You have unsaved changes. Navigating away will discard these changes. Are you sure you want to discard your changes?'
          )
        ) {
          this.unloadModel();
          this.set('hasChanges', false);
          return true;
        } else {
          transition.abort();
          return false;
        }
      }
      return this._super(...arguments);
    },

    hasDataChanges(hasChanges) {
      this.set('hasChanges', hasChanges);
    },
  },
});
