import * as apigw from '@aws-cdk/aws-apigateway';
import * as cloudwatch from '@aws-cdk/aws-cloudwatch';
import * as cloudwatch_actions from '@aws-cdk/aws-cloudwatch-actions';
import * as dynamodb from '@aws-cdk/aws-dynamodb';
import * as ecs from '@aws-cdk/aws-ecs';
import { ApplicationTargetGroup } from '@aws-cdk/aws-elasticloadbalancingv2';
import * as lambda from '@aws-cdk/aws-lambda';
import * as rds from '@aws-cdk/aws-rds';
import * as sns from '@aws-cdk/aws-sns';
import * as sns_subscriptions from '@aws-cdk/aws-sns-subscriptions';
import * as sqs from '@aws-cdk/aws-sqs';
import { Construct, CfnOutput, Aspects } from '@aws-cdk/core';
import { IWatchful, SectionOptions } from './api';
import { WatchApiGatewayOptions, WatchApiGateway } from './api-gateway';
import { WatchfulAspect, WatchfulAspectProps } from './aspect';
import { WatchDynamoTableOptions, WatchDynamoTable } from './dynamodb';
import { WatchEcsServiceOptions, WatchEcsService } from './ecs';
import { WatchLambdaFunctionOptions, WatchLambdaFunction } from './lambda';
import { WatchRdsAuroraOptions, WatchRdsAurora } from './rds-aurora';
import { SectionWidget } from './widget/section';

export interface WatchfulProps {
  /**
   * Email address to send alarms to.
   * @default - alarms are not sent to an email recipient.
   */
  readonly alarmEmail?: string;

  /**
   * SQS queue to send alarms to.
   * @default - alarms are not sent to an SQS queue.
   */
  readonly alarmSqs?: sqs.IQueue;

  /**
   * SNS topic to send alarms to.
   * @default - alarms are not sent to an SNS Topic.
   */
  readonly alarmSns?: sns.ITopic;

  /**
   * The name of the CloudWatch dashboard generated by Watchful.
   * 
   * @default - auto-generated
   */
  readonly dashboardName?: string;

  /**
   * ARNs of actions to perform when alarms go off. These actions are in
   * addition to email/sqs/sns.
   *
   * @default []
   */
  readonly alarmActionArns?: string[];

  /**
   * Whether to generate CloudWatch dashboards
   *
   * @default true
   */
  readonly dashboard?: boolean;
}

export class Watchful extends Construct implements IWatchful {
  private readonly dash?: cloudwatch.Dashboard;
  private readonly alarmTopic?: sns.ITopic;
  private readonly alarmActionArns: string[];

  constructor(scope: Construct, id: string, props: WatchfulProps = { }) {
    super(scope, id);

    this.alarmActionArns = props.alarmActionArns ?? [];

    if ((props.alarmEmail || props.alarmSqs) && !props.alarmSns) {
      this.alarmTopic = new sns.Topic(this, 'AlarmTopic', { displayName: 'Watchful Alarms' });
    }

    if (props.alarmSns) {
      this.alarmTopic = props.alarmSns;
    }

    if (props.alarmEmail && this.alarmTopic) {
      this.alarmTopic.addSubscription(
        new sns_subscriptions.EmailSubscription(props.alarmEmail),
      );
    }

    if (props.alarmSqs && this.alarmTopic) {
      this.alarmTopic.addSubscription(
        new sns_subscriptions.SqsSubscription(
          // sqs.Queue.fromQueueArn(this, 'AlarmQueue', props.alarmSqs)
          props.alarmSqs,
        ),
      );
    }

    if (props.dashboard === false && props.dashboardName) {
      throw new Error('Dashboard name is provided but dashboard creation is disabled');
    }
    if (props.dashboard !== false) {
      this.dash = new cloudwatch.Dashboard(this, 'Dashboard', { dashboardName: props.dashboardName });

      new CfnOutput(this, 'WatchfulDashboard', {
        value: linkForDashboard(this.dash),
      });
    }

  }

  public addWidgets(...widgets: cloudwatch.IWidget[]) {
    this.dash?.addWidgets(...widgets);
  }

  public addAlarm(alarm: cloudwatch.Alarm) {
    if (this.alarmTopic) {
      alarm.addAlarmAction(new cloudwatch_actions.SnsAction(this.alarmTopic));
    }

    // create a list of IAlarmAction from ARNs
    const alarmActionForArn: (arn: string) => cloudwatch.IAlarmAction = alarmActionArn => ({ bind: () => ({ alarmActionArn }) });
    alarm.addAlarmAction(...this.alarmActionArns.map(alarmActionForArn));
  }

  public addSection(title: string, options: SectionOptions = {}) {
    this.addWidgets(new SectionWidget({
      titleLevel: 1,
      titleMarkdown: title,
      quicklinks: options.links,
    }));
  }

  public watchScope(scope: Construct, options?: WatchfulAspectProps) {
    const aspect = new WatchfulAspect(this, options);
    Aspects.of(scope).add(aspect);
  }

  public watchDynamoTable(title: string, table: dynamodb.Table, options: WatchDynamoTableOptions = {}) {
    return new WatchDynamoTable(this, table.node.uniqueId, {
      title,
      watchful: this,
      table,
      ...options,
    });
  }

  public watchApiGateway(title: string, restApi: apigw.RestApi, options: WatchApiGatewayOptions = {}) {
    return new WatchApiGateway(this, restApi.node.uniqueId, {
      title, watchful: this, restApi, ...options,
    });
  }

  public watchLambdaFunction(title: string, fn: lambda.Function, options: WatchLambdaFunctionOptions = {}) {
    return new WatchLambdaFunction(this, fn.node.uniqueId, {
      title, watchful: this, fn, ...options,
    });
  }

  public watchRdsAuroraCluster(title: string, cluster: rds.DatabaseCluster, options: WatchRdsAuroraOptions = {}) {
    return new WatchRdsAurora(this, cluster.node.uniqueId, {
      title, watchful: this, cluster, ...options,
    });
  }
  public watchFargateEcs(title: string, fargateService: ecs.FargateService, targetGroup: ApplicationTargetGroup,
    options: WatchEcsServiceOptions = {}) {

    return new WatchEcsService(this, fargateService.node.uniqueId, {
      title, watchful: this, fargateService, targetGroup, ...options,
    });
  }
  public watchEc2Ecs(title: string, ec2Service: ecs.Ec2Service, targetGroup: ApplicationTargetGroup, options: WatchEcsServiceOptions = {}) {
    return new WatchEcsService(this, ec2Service.node.uniqueId, {
      title, watchful: this, ec2Service, targetGroup, ...options,
    });
  }
}

function linkForDashboard(dashboard: cloudwatch.Dashboard) {
  const cfnDashboard = dashboard.node.defaultChild as cloudwatch.CfnDashboard;
  return `https://console.aws.amazon.com/cloudwatch/home?region=${dashboard.stack.region}#dashboards:name=${cfnDashboard.ref}`;
}
